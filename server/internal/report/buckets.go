package report

import (
	"fmt"
	"time"
)

// Bucket intervals.
const (
	BucketDay     = "day"
	BucketWeek    = "week"
	BucketMonth   = "month"
	BucketQuarter = "quarter"
	BucketYear    = "year"
)

const dateLayout = "2006-01-02"

// ValidBucket reports whether b is a supported interval.
func ValidBucket(b string) bool {
	switch b {
	case BucketDay, BucketWeek, BucketMonth, BucketQuarter, BucketYear:
		return true
	}
	return false
}

// bucketExpr returns the SQL expression (over the transactions alias t) that
// produces a bucket key matching BucketKey exactly, so SQL deltas align with
// Go-generated bucket axes.
func bucketExpr(interval string) string {
	switch interval {
	case BucketWeek:
		// Monday of the week (ISO-style), as YYYY-MM-DD.
		return "date(t.date, '-' || ((strftime('%w', t.date) + 6) % 7) || ' days')"
	case BucketMonth:
		return "substr(t.date, 1, 7)"
	case BucketQuarter:
		return "substr(t.date, 1, 4) || '-Q' || ((CAST(substr(t.date, 6, 2) AS INTEGER) + 2) / 3)"
	case BucketYear:
		return "substr(t.date, 1, 4)"
	default: // day
		return "substr(t.date, 1, 10)"
	}
}

// bucketStart returns the first day of the bucket containing d.
func bucketStart(d time.Time, interval string) time.Time {
	y, m, day := d.Date()
	switch interval {
	case BucketWeek:
		// Back up to Monday (Go: Sunday = 0).
		off := (int(d.Weekday()) + 6) % 7
		return time.Date(y, m, day, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -off)
	case BucketMonth:
		return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC)
	case BucketQuarter:
		qm := time.Month((int(m)-1)/3*3 + 1)
		return time.Date(y, qm, 1, 0, 0, 0, 0, time.UTC)
	case BucketYear:
		return time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
	default: // day
		return time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
	}
}

// nextBucket advances to the start of the following bucket.
func nextBucket(start time.Time, interval string) time.Time {
	switch interval {
	case BucketWeek:
		return start.AddDate(0, 0, 7)
	case BucketMonth:
		return start.AddDate(0, 1, 0)
	case BucketQuarter:
		return start.AddDate(0, 3, 0)
	case BucketYear:
		return start.AddDate(1, 0, 0)
	default: // day
		return start.AddDate(0, 0, 1)
	}
}

// bucketKeyOf renders the bucket key for a bucket start date.
func bucketKeyOf(start time.Time, interval string) string {
	switch interval {
	case BucketMonth:
		return start.Format("2006-01")
	case BucketQuarter:
		return fmt.Sprintf("%d-Q%d", start.Year(), (int(start.Month())-1)/3+1)
	case BucketYear:
		return start.Format("2006")
	default: // day, week
		return start.Format(dateLayout)
	}
}

// BucketKey computes the bucket key for a civil date.
func BucketKey(date, interval string) (string, error) {
	d, err := time.Parse(dateLayout, date)
	if err != nil {
		return "", err
	}
	return bucketKeyOf(bucketStart(d, interval), interval), nil
}

// GenerateBuckets returns the ordered bucket keys from `from`'s bucket through
// `to`'s bucket, inclusive. Boundaries are computed on the civil calendar so
// they are correct across month/quarter/year edges.
func GenerateBuckets(from, to, interval string) ([]string, error) {
	f, err := time.Parse(dateLayout, from)
	if err != nil {
		return nil, err
	}
	t, err := time.Parse(dateLayout, to)
	if err != nil {
		return nil, err
	}
	cur := bucketStart(f, interval)
	end := bucketStart(t, interval)
	var out []string
	for !cur.After(end) {
		out = append(out, bucketKeyOf(cur, interval))
		cur = nextBucket(cur, interval)
	}
	return out, nil
}
