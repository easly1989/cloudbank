package importio

import (
	"context"
	"strings"
	"testing"
)

func commitPreview(t *testing.T, s *Service, wid, acc int64, pv Preview) {
	t.Helper()
	rows := make([]CommitRow, 0, len(pv.Rows))
	for _, r := range pv.Rows {
		if !r.Include {
			continue
		}
		rows = append(rows, CommitRow{
			Date: r.Date, Amount: r.Amount, PaymentMode: r.PaymentMode, Info: r.Info,
			Payee: r.Payee, Memo: r.Memo, Category: r.Category, Tags: r.Tags, ImportRef: r.ImportRef,
		})
	}
	if _, err := s.Commit(context.Background(), wid, acc, rows); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestPreviewParsedQIF(t *testing.T) {
	s, _, _, _, wid, acc := newTestService(t)
	ctx := context.Background()
	rows, _ := ParseQIF(sampleQIF, "")
	pv, err := s.PreviewParsed(ctx, wid, acc, rows, false)
	if err != nil {
		t.Fatalf("PreviewParsed: %v", err)
	}
	if len(pv.Rows) != 4 {
		t.Fatalf("rows = %d, want 4", len(pv.Rows))
	}
	// Amounts rescaled to the 2-digit account currency.
	if pv.Rows[0].Amount != -1234 || pv.Rows[1].Amount != 150000 {
		t.Fatalf("amounts = %d, %d", pv.Rows[0].Amount, pv.Rows[1].Amount)
	}
}

func TestOFXFITIDDedupe(t *testing.T) {
	s, _, _, _, wid, acc := newTestService(t)
	ctx := context.Background()

	rows, _ := ParseOFX(sampleOFXSGML)
	pv, err := s.PreviewParsed(ctx, wid, acc, rows, false)
	if err != nil {
		t.Fatalf("PreviewParsed: %v", err)
	}
	for _, r := range pv.Rows {
		if r.Duplicate || !r.Include || r.ImportRef == "" {
			t.Fatalf("first import row unexpected: %+v", r)
		}
	}
	commitPreview(t, s, wid, acc, pv)

	// Re-importing the same file: every row is flagged a duplicate by FITID.
	rows2, _ := ParseOFX(sampleOFXSGML)
	pv2, _ := s.PreviewParsed(ctx, wid, acc, rows2, false)
	for _, r := range pv2.Rows {
		if !r.Duplicate || r.Include {
			t.Fatalf("re-import row should be a flagged duplicate: %+v", r)
		}
	}

	// FITID dedupe is independent of date+amount: a row with an already-seen
	// FITID but a different date and amount is still a duplicate.
	moved := []Row{{Line: 1, Date: "2026-09-09", Amount: -99999000, FITID: "ABC123"}}
	pv3, _ := s.PreviewParsed(ctx, wid, acc, moved, false)
	if !pv3.Rows[0].Duplicate {
		t.Fatalf("FITID-only duplicate not detected: %+v", pv3.Rows[0])
	}

	// A genuinely new FITID + new date/amount is not a duplicate.
	fresh := []Row{{Line: 1, Date: "2026-09-10", Amount: -12300000, FITID: "NEW999"}}
	pv4, _ := s.PreviewParsed(ctx, wid, acc, fresh, false)
	if pv4.Rows[0].Duplicate {
		t.Fatalf("new row wrongly flagged: %+v", pv4.Rows[0])
	}
}

func TestExportQIFThroughService(t *testing.T) {
	s, _, _, _, wid, acc := newTestService(t)
	ctx := context.Background()

	pv, _ := s.Preview(ctx, wid, PreviewRequest{AccountID: acc, Content: sampleCSV, Dialect: DialectHomeBank})
	commitPreview(t, s, wid, acc, pv)

	out, err := s.ExportAccountQIF(ctx, wid, acc)
	if err != nil {
		t.Fatalf("ExportAccountQIF: %v", err)
	}
	if !strings.HasPrefix(out, "!Type:") || !strings.Contains(out, "Food:Groceries") {
		t.Fatalf("QIF export missing header/category:\n%s", out)
	}
	reparsed, err := ParseQIF(out, "")
	if err != nil {
		t.Fatalf("re-ParseQIF: %v", err)
	}
	if len(reparsed) != 2 {
		t.Fatalf("re-parsed rows = %d, want 2", len(reparsed))
	}
	if rescaleAmount(reparsed[0].Amount, 2) != -1234 || reparsed[0].Category != "Food:Groceries" {
		t.Fatalf("round-trip row0 = %+v", reparsed[0])
	}
}
