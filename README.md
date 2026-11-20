# Client portal

Private spaces for clients, friends and family, at `client.dylanhughes.dev`. Each space has its own address
(`client.dylanhughes.dev/acme`) and opens with a code, no account needed. A space holds sections of pictures, films,
3D models, live website previews, files and written notes; visitors can leave notes on any of them.

It is a static site (GitHub Pages) in front of a Supabase project, which holds the data and the files and decides who
can see what.

## What is here

| Path | What it is |
| --- | --- |
| `index.html`, `404.html` | The page shell. `404.html` is a copy, so every space's address loads the app. |
| `css/portal.css` | All styling: the main site's tokens, type and title blocks. |
| `js/config.js` | **The two values you fill in** to connect Supabase. |
| `js/app.js`, `js/chunks/` | Built from `src/`. Don't edit by hand. |
| `src/` | The source: `views/` (screens), `data/` (Supabase and demo sources), `ui/`, `viewers/`. |
| `supabase/schema.sql` | The database: tables, access rules, code checking, the file bucket. |
| `assets/demo/` | Sample media for the demo space. |

Until `js/config.js` is filled in, the portal runs as a **demo**: one sample space (`/demo`, code `DEMO-2026`) and a
working admin (`/admin`, any email and password), with everything kept in the visitor's own browser.

## Setting it up

About fifteen minutes. Menu names in Supabase move around now and then; the things to find are named below.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough to start).
2. **SQL Editor** → new query → paste all of `supabase/schema.sql` → Run. It can be run again safely after updates.
3. **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins**. (This is what lets a visitor in
   with only a code. Leave "Allow new users to sign up" on: turning it off also blocks anonymous visitors.)
4. **Authentication → Users → Add user**: your email and a strong password, with "Auto confirm" ticked. This is your
   admin sign-in.
5. Back in the **SQL Editor**, make that user the owner (put your email in):

   ```sql
   insert into public.portal_admins (user_id) select id from auth.users where email = 'you@example.com';
   ```

6. **Project Settings → API**: copy the **Project URL** and the **publishable key** (older projects call it the
   `anon` key). Put both in `js/config.js` and commit. These two are meant to be public; the access rules are what
   protect the data. Never put the `service_role` or a secret key in this repository.

### 2. The address

1. At your DNS provider for `dylanhughes.dev`, add a record: type `CNAME`, name `client`, value `d1elon.github.io`.
2. In this repository: **Settings → Pages** → deploy from the `main` branch, root folder. The custom domain
   (`client.dylanhughes.dev`) is already set by the `CNAME` file; tick **Enforce HTTPS** once it is offered.

### 3. First space

Go to `client.dylanhughes.dev/admin`, sign in, press **New space**. On its **Access** tab make a code, then
**Copy an invitation** to get a message with the address, the code, and a link that fills the code in.

## Using it

- **Content**: add sections; in each, upload files (or drop them on the section), add a website preview, a video
  link or a written note. Titles, descriptions and "notes from you" save when you leave the field.
- **Notes**: everything visitors have written, by item. Reply, mark done, delete.
- **Access**: the code (shown again whenever you need it), the address, who has opened the space, pause, delete.
  Making a new code closes the space to everyone who used the old one.
- **View as a client** shows the space as they see it. Your notes there are signed with your name.

Things worth knowing:

- Files are limited to **50 MB** each (the free plan's limit). Longer films go in as a YouTube or Vimeo link.
- JPEG photos have their camera details and location removed as they upload (the picture itself isn't
  re-compressed). The tick box above the sections turns this off. **Videos and other formats keep their metadata.**
- Website previews show the live site in desktop (1440 × 900), tablet (820 × 1180) and phone (390 × 844) frames. A
  few sites refuse to be shown inside another page; for those the "Open the live site" button still works.
- 3D models: GLB, glTF (self-contained), STL, OBJ, 3MF and PLY. Draco-compressed glTF isn't supported.
- A code keeps a space open on a visitor's device for 30 days. Eight wrong codes from one visitor locks them out for
  fifteen minutes.
- Free Supabase projects **pause after about a week with no activity**; a paused project means spaces don't open
  until you resume it from the Supabase dashboard. Check the plan's current limits for storage and transfer.

## How access works

- A visitor's browser gets an anonymous Supabase session the first time they try a code. The database function
  `portal_redeem` checks the code against a bcrypt hash, counts wrong guesses, and on success records that this
  session may read that one space. It gives the same answer for a wrong code, a paused space and an address that
  doesn't exist.
- Row-level security does the rest: a session can read a space's rows and files only while that record is live.
  Visitors can add notes and delete their own; nothing else. Only the account listed in `portal_admins` can change
  content, read codes or see other spaces.
- Files sit in a private storage bucket and are handed out as links that expire after six hours.
- The pages ask search engines not to index them, and the code in an invitation link sits after the `#`, which is
  never sent to a server.

The rules are in `supabase/schema.sql` and were tested against Postgres 16: a visitor with no code, with the wrong
code, with another space's code, after the code changes, after the space is paused, and trying to write, edit or
read things they shouldn't.

## Working on it

```sh
npm install
npm run build      # src/ -> js/, and index.html -> 404.html
npm run serve      # http://127.0.0.1:4200, serving the app for any address as GitHub Pages will
npm run watch      # rebuild on change
```

Built files are committed, because GitHub Pages serves the repository as it is. After changing anything in `src/`
or `index.html`, run `npm run build` before committing.
