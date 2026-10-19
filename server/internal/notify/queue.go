package notify

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// backoff is the wait before each new try of a delivery that failed for a
// reason worth retrying: five more tries over about eight and a half hours.
var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour}

const (
	timeLayout = "2006-01-02T15:04:05.000Z"
	// pollEvery is how often the worker looks for a retry that came due; a
	// new delivery wakes it at once.
	pollEvery = 15 * time.Second
	batch     = 50
)

func stamp(t time.Time) string { return t.UTC().Format(timeLayout) }

// enqueue queues one event for one channel. It survives a restart.
func (s *Service) enqueue(ctx context.Context, userID int64, ch Channel, e Event) error {
	payload, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return s.q.InsertNotificationDelivery(ctx, db.InsertNotificationDeliveryParams{
		UserID: userID, Channel: string(ch), Payload: string(payload), NextAt: stamp(s.now()),
	})
}

// kick wakes the worker without waiting for it.
func (s *Service) kick() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Service) runDeliveries(ctx context.Context) {
	ticker := time.NewTicker(pollEvery)
	defer ticker.Stop()
	for {
		s.deliverDue(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

// deliverDue tries every delivery that is due. A success or a failure not
// worth retrying ends it; any failure is written on the channel for the page.
func (s *Service) deliverDue(ctx context.Context) {
	for {
		due, err := s.q.ListDueNotificationDeliveries(ctx, db.ListDueNotificationDeliveriesParams{NextAt: stamp(s.now()), Limit: batch})
		if err != nil {
			s.logger.Error("notification queue", "error", err)
			return
		}
		for _, d := range due {
			s.deliver(ctx, d)
		}
		if len(due) < batch || ctx.Err() != nil {
			return
		}
	}
}

func (s *Service) deliver(ctx context.Context, d db.NotificationDelivery) {
	ch := Channel(d.Channel)
	var e Event
	snd := s.senders[ch]
	if snd == nil || json.Unmarshal([]byte(d.Payload), &e) != nil {
		_ = s.q.DeleteNotificationDelivery(ctx, d.ID)
		return
	}
	to, ok, err := s.recipient(ctx, d.UserID, ch)
	if err != nil {
		return // the database: the delivery stays due and is tried again
	}
	if !ok {
		// The person removed the channel since.
		_ = s.q.DeleteNotificationDelivery(ctx, d.ID)
		return
	}
	if ok, next := s.allow(ch, to); !ok {
		// Over the hourly cap: it waits, without spending a try.
		s.recordError(ctx, d.UserID, ch, &DeliveryError{Reason: ReasonLimited})
		_ = s.q.RescheduleNotificationDelivery(ctx, db.RescheduleNotificationDeliveryParams{
			Attempts: d.Attempts, NextAt: stamp(next), ID: d.ID,
		})
		return
	}
	err = snd.Send(ctx, to, e)
	if err == nil {
		_ = s.q.DeleteNotificationDelivery(ctx, d.ID)
		s.recordOK(ctx, d.UserID, ch)
		return
	}
	de := asDeliveryError(err)
	s.recordError(ctx, d.UserID, ch, de)
	attempts := int(d.Attempts) + 1
	if !de.retry() || attempts > len(backoff) {
		s.logger.Warn("notification dropped", "channel", ch, "user", d.UserID, "reason", de.Error(), "attempts", attempts)
		_ = s.q.DeleteNotificationDelivery(ctx, d.ID)
		return
	}
	_ = s.q.RescheduleNotificationDelivery(ctx, db.RescheduleNotificationDeliveryParams{
		Attempts: int64(attempts), NextAt: stamp(s.now().Add(backoff[attempts-1])), ID: d.ID,
	})
}

// recipient is the person and, for an addressed channel, their address on
// it; ok is false when that channel is not set up, or not proved yet.
func (s *Service) recipient(ctx context.Context, userID int64, ch Channel) (Recipient, bool, error) {
	to := Recipient{UserID: userID}
	if !addressed(ch) {
		return to, true, nil
	}
	row, err := s.rq.GetNotificationChannel(ctx, db.GetNotificationChannelParams{UserID: userID, Channel: string(ch)})
	if errors.Is(err, sql.ErrNoRows) {
		return to, false, nil
	}
	if err != nil {
		return to, false, err
	}
	return rowRecipient(userID, row), row.Verified != 0, nil
}

// rowRecipient opens a stored channel.
func rowRecipient(userID int64, row db.NotificationChannel) Recipient {
	return Recipient{
		UserID: userID, Target: secrets.Open(row.Target), Secret: secrets.Open(row.Secret),
		Server: row.Server, Options: parseOptions(row.Options), LocalOK: row.LocalOk != 0,
	}
}

// parseOptions reads a channel's stored options; anything unreadable is none.
func parseOptions(raw string) ChannelOptions {
	var o ChannelOptions
	_ = json.Unmarshal([]byte(raw), &o)
	return o
}

func (s *Service) recordOK(ctx context.Context, userID int64, ch Channel) {
	if addressed(ch) {
		_ = s.q.SetNotificationChannelOK(ctx, db.SetNotificationChannelOKParams{UserID: userID, Channel: string(ch)})
	}
}

func (s *Service) recordError(ctx context.Context, userID int64, ch Channel, de *DeliveryError) {
	if addressed(ch) {
		_ = s.q.SetNotificationChannelError(ctx, db.SetNotificationChannelErrorParams{
			LastError: de.Error(), UserID: userID, Channel: string(ch),
		})
	}
}
