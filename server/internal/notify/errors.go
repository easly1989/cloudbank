package notify

import (
	"errors"
	"net"
	"net/textproto"
	"strconv"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

// Reason says why a delivery failed, in the words the settings page shows.
type Reason string

// The reasons a delivery can fail for.
const (
	// ReasonUnauthorized: the service refused the credentials (401, 403, SMTP 535).
	ReasonUnauthorized Reason = "unauthorized"
	// ReasonRejected: the service refused the message itself; trying again
	// would not help.
	ReasonRejected Reason = "rejected"
	// ReasonUnreachable: no answer, or a temporary refusal; worth trying again.
	ReasonUnreachable Reason = "unreachable"
	// ReasonLocal: the address is on the local network and the channel was not
	// saved by an administrator.
	ReasonLocal Reason = "local"
	// ReasonLimited: the person reached the hourly cap; the rest follows in
	// the next hour.
	ReasonLimited Reason = "limited"
)

// DeliveryError is a failed delivery. It never carries the target's address
// or the service's answer: the page shows only the reason and the status.
type DeliveryError struct {
	Reason Reason
	// Status is the HTTP or SMTP status, when the service gave one.
	Status int
}

// Error is what the page shows after "Last delivery failed:": the status when
// there is one, else the reason.
func (e *DeliveryError) Error() string {
	if e.Status != 0 {
		return strconv.Itoa(e.Status)
	}
	return string(e.Reason)
}

// retry reports whether trying again later may succeed.
func (e *DeliveryError) retry() bool { return e.Reason == ReasonUnreachable }

// httpStatusError classifies an HTTP status that is not a success.
func httpStatusError(code int) *DeliveryError {
	switch {
	case code == 401 || code == 403:
		return &DeliveryError{Reason: ReasonUnauthorized, Status: code}
	case code == 408 || code == 429 || code >= 500:
		return &DeliveryError{Reason: ReasonUnreachable, Status: code}
	default:
		return &DeliveryError{Reason: ReasonRejected, Status: code}
	}
}

// smtpStatusError classifies an SMTP reply code.
func smtpStatusError(code int) *DeliveryError {
	switch {
	case code == 530 || code == 534 || code == 535:
		return &DeliveryError{Reason: ReasonUnauthorized, Status: code}
	case code >= 400 && code < 500:
		return &DeliveryError{Reason: ReasonUnreachable, Status: code}
	default:
		return &DeliveryError{Reason: ReasonRejected, Status: code}
	}
}

// asDeliveryError turns any error from a sender into a DeliveryError. One
// with no recognisable cause counts as unreachable, so it is tried again.
func asDeliveryError(err error) *DeliveryError {
	var de *DeliveryError
	if errors.As(err, &de) {
		return de
	}
	if errors.Is(err, netguard.ErrNotPublic) {
		return &DeliveryError{Reason: ReasonLocal}
	}
	var tp *textproto.Error
	if errors.As(err, &tp) {
		return smtpStatusError(tp.Code)
	}
	var ne net.Error
	if errors.As(err, &ne) {
		return &DeliveryError{Reason: ReasonUnreachable}
	}
	return &DeliveryError{Reason: ReasonUnreachable}
}
