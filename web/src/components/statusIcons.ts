import {
  IconBan,
  IconBell,
  IconCheck,
  IconCircleDashed,
  IconLock,
  type Icon,
} from "@tabler/icons-react";

// One icon per reconcile status, in code order: none, cleared, reconciled,
// remind, void. The lock is the one the register already puts beside a
// reconciled row, so the two read as the same thing. The status picker draws
// them, and so does the schedules calendar, so a status looks the same in both.
export const STATUS_ICONS: Icon[] = [IconCircleDashed, IconCheck, IconLock, IconBell, IconBan];
