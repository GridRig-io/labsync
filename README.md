# LabSync

Laboratory management for medical labs: stock and reagent lots, blood bank, equipment and cold chain, and team tasks. It's an installable web app (PWA), so it works on phones at the bench and on desktop in the office.

**Stack:** React + Vite + TypeScript · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions, pg_cron) · Vercel

## Design: "Bench Ledger"

The look is modelled on a printed lab register: paper and ink, hairline rules, square edges, IBM Plex Sans/Mono. Colour always means something:

| Mark | Meaning |
|---|---|
| ■ red square | critical: expired, below minimum, out of range, reactive |
| ▲ amber triangle | warning: expiring soon, below par, due |
| ● green dot | OK, available, in range |
| □ blue outline | info: quarantine, in progress |

Status always uses a shape and a word as well as a colour. The app has two themes, Paper (light) and Night shift (dark).

## What's in v3

- **Today** shows a ranked "needs attention" list, the blood stock strip, counts, your tasks and recent activity
- **Inventory** has items, lots ordered first-expiry-first-out, and a 3-tap *Use stock* with undo. Also receive, adjust count, discard with a reason, mark opened (effective expiry is opened date + stability), and flag damaged
- **Blood bank** has the group × component matrix against minimums, quarantine → release (only when all 4 screens are non-reactive), reserve with automatic release, issue to ward, return and discard. Every status change is kept in a history
- **Equipment & cold chain** has temperature rounds (it moves on to the next fridge that's due), out-of-range alerts that require the action taken, alerts for missed readings, a 14-day chart, and a maintenance log that recalculates next due dates
- **Tasks** has list and board views, checklists, comments, recurrence, and links to items, equipment or blood units
- **Alerts** are created by the database (hourly job plus triggers). They arrive live, with a sound and vibration
- **Staff accounts** are created in the app by the admin (edge function), using temporary passwords and roles
- **Audit log** keeps a before/after record of every change
- **Multi-lab ready**: every row has a `lab_id` and RLS isolates labs, so more labs can be onboarded later with no schema change

## Roles

| | Admin | Supervisor | Inventory officer | Staff |
|---|---|---|---|---|
| Use stock, log temperatures, own tasks | ✓ | ✓ | ✓ | ✓ |
| Receive / adjust / discard stock, manage items | ✓ | ✓ | ✓ | |
| Blood units | ✓ | ✓ | ✓ | |
| Equipment, blood minimums, assign tasks to anyone | ✓ | ✓ | | |
| Staff, lab settings, audit log | ✓ | | | |

## Local development

```bash
cp .env.example .env    # add your Supabase URL + publishable key
npm install
npm run dev
```

## Database

Migrations are in `supabase/migrations` (apply them in order). The edge function is in `supabase/functions/manage-staff`.

The first user created in Supabase Auth becomes the **admin** of the first lab. After that, the admin adds everyone else from **Settings → Staff**.

## Deploy

Vercel is connected to this repo, so every push to `main` deploys. Required environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the publishable key)

## Roadmap

Notes and voice notes · reminders · reports with CSV/Excel/PDF export · web push / email alerts · procurement · onboarding for multiple labs.
