# Setting up the Megagame app (Windows, step by step)

This guide gets the app live at a public web address that your players can open.
You **don't need to install anything on your PC** for this part. Everything happens in your web browser.

It takes about 20–30 minutes the first time.

---

## What you'll set up, and why

| Service | What it does for the app | Cost |
|---|---|---|
| **GitHub** (you already have it) | Stores the app's code. When the code changes, the other services notice automatically. | Free |
| **Supabase** | The **database**: teams, map, units, orders and so on. Later it will also store uploaded map images. | Free tier (500 MB database, 1 GB files: plenty for this) |
| **Vercel** | **Hosting**: runs the app and gives you the public link players open. Every time new code is merged on GitHub, Vercel rebuilds the site by itself. | Free "Hobby" tier |

You can sign up to both Supabase and Vercel **with your GitHub account**, so you don't need new passwords.
Neither asks for a credit card on the free tier.

> **Note:** Supabase pauses free projects that nobody uses for 7 days. If that happens, log in to Supabase and click **Restore project**. While a game is running, players visit every week, so this normally won't happen mid-game.

---

## Step 1: Put the code on a `main` branch in GitHub

I pushed the code to a branch called `claude/loving-brahmagupta-jaf0pw`. Branches are parallel copies of the code.
We'll make a tidy `main` branch that always holds the **live** version.
Later phases arrive as "pull requests" that you merge into `main` with one click.

1. Open <https://github.com/GroudonMcL/Megegame-Test>.
2. Near the top left there's a button showing a branch name (it probably says `claude/loving-brahmagupta-jaf0pw`). Click it.
3. In the box, type `main`, then click **Create branch main from claude/loving-brahmagupta-jaf0pw**.
4. Click **Settings** (top of the repo page) → **General**. Under **Default branch**, click the ⇄ (switch) button, choose `main`, click **Update**, and confirm.

---

## Step 2: Create the database (Supabase)

1. Go to <https://supabase.com> and click **Start your project**. Choose **Continue with GitHub**.
2. If asked, create an **organization**. Any name works (e.g. your name), and choose the **Free** plan.
3. Click **New project**:
   - **Name:** `megagame`
   - **Database password:** click **Generate a password**, then **copy it into Notepad** (you need it in a minute). Symbols in the password are fine.
   - **Region:** choose **West EU (London)** (or the region nearest you and your players; see the note in Step 4).
   - Click **Create new project** and wait a minute or two while it sets up.
4. When it's ready, click the **Connect** button at the top of the project page.
5. In the window that opens, find the **Connection string** section and pick **Transaction pooler**. (Don't pick "Direct connection" or "Session pooler".)
6. Copy the connection string. It looks like:
   ```
   postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
   ```
7. Paste it into Notepad and **replace `[YOUR-PASSWORD]`** (including the square brackets) with the password from step 3. Check that it ends in `:6543/postgres`.

That finished line is your **`DATABASE_URL`**. Keep it secret: anyone with it can read and change the whole database.

---

## Step 3: Make two more secrets

### `SESSION_SECRET`

This is a long random string. The app uses it to sign login cookies, so nobody can fake being the DM or another team.

1. Press the **Windows key**, type `PowerShell`, and open **Windows PowerShell**.
2. Copy and paste this line, then press **Enter**:
   ```powershell
   $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
3. It prints something like `q8V3m+...==`. Copy that line into Notepad.

### `DM_PASSWORD`

This is the password **you** type to log in as the Game Master. Pick something only you know.

---

## Step 4: Put the app online (Vercel)

1. Go to <https://vercel.com/signup>. Choose **Hobby** ("I'm working on personal projects"), then **Continue with GitHub**.
2. On your Vercel dashboard, click **Add New… → Project**.
3. Under **Import Git Repository**, find **Megegame-Test** and click **Import**.
   - If it's not listed, click **Adjust GitHub App Permissions** (or **Configure GitHub App**), give Vercel access to the `Megegame-Test` repository, and come back.
4. On the "Configure Project" screen:
   - **Framework Preset** should already say **Next.js**. Leave the build settings alone.
   - Open **Environment Variables** and add these three (name on the left, value on the right; click **Add** after each):

     | Name | Value |
     |---|---|
     | `DATABASE_URL` | the connection string from Step 2 |
     | `SESSION_SECRET` | the random string from Step 3 |
     | `DM_PASSWORD` | your DM password |

5. Click **Deploy**. It takes 1–3 minutes. The first deploy also creates the database tables automatically.
6. When you see "Congratulations!", click the preview image or **Continue to Dashboard → Visit**. Your public link looks like `https://megegame-test.vercel.app` (yours may differ slightly).

> **Region note:** the code tells Vercel to run the app in London (`lhr1`, set in `vercel.json`) so it sits next to a London database. If you chose a different Supabase region, tell me and I'll change it. Being far apart makes every page slower.

### Did it work?

Scroll to the bottom of the home page. Under **Setup status** you should see three green ticks:

```
✓ SESSION_SECRET: set
✓ DM_PASSWORD: set
✓ Database: connected
```

If anything has a red ✗, see **Troubleshooting** below.

---

## Step 5: Try the login (the Phase 1 checklist)

1. On your live site, click **DM login** and enter your DM password. You land on the **DM dashboard**.
2. Type a game name (e.g. `Test Game`) and click **Create game**.
3. Under that game, type a team name (e.g. `Test Team`), pick a colour, and click **Add team**. A **join code** appears, like `R8PM-3XSQ-7AE4`.
4. Open the same link on your **phone** (or in a private/incognito browser window), enter the join code and a display name, and click **Join team**.
   You should see "Welcome, *your name*! You're playing in Test Game."
   - Codes aren't fussy about capitals, spaces or dashes: `r8pm 3xsq 7ae4` works too.
5. Refresh the DM dashboard. Under the team it now says **Joined: *your name***.
6. Click **New code** on the team. On the phone, refresh: you're sent back to the join screen with "Your session ended". This is how you kick people off a team if a code leaks.
7. Try a wrong DM password and a made-up join code. Both should be refused with a clear message.

---

## How updates get deployed (from now on)

1. At the end of each phase I push the new code to my branch and (when you're happy with it) open a **pull request** on GitHub. It shows exactly what changed.
2. You open it on GitHub and click **Merge pull request → Confirm merge**.
3. Vercel notices the change to `main` and rebuilds the site by itself, usually in 1–3 minutes. Any database changes the new code needs are applied during that build. You don't run anything yourself.
4. To watch it happen: Vercel dashboard → your project → **Deployments**. A green **Ready** means it's live.

**If an update breaks something:** in Vercel → **Deployments**, find the last working deployment, click the **⋯** menu and choose **Instant Rollback**. The site goes straight back to the previous version.

Vercel also builds a private **preview** copy for each pull request before you merge it. Those previews are only visible to you (Vercel asks you to log in), and they never change the database.

---

## Troubleshooting

| What you see | What it means / what to do |
|---|---|
| The Vercel build fails with `DATABASE_URL is not set` | The environment variable is missing or misspelled. Vercel → project → **Settings → Environment Variables**, fix it, then **Deployments → ⋯ → Redeploy**. |
| The build log says `Migration failed:` followed by a sentence | That sentence says what's wrong with `DATABASE_URL` and how to fix it. After fixing the variable, **Redeploy**. |
| `Database: can't connect (password authentication failed…)` | The password in `DATABASE_URL` is wrong, or the `[YOUR-PASSWORD]` brackets are still there. You can reset the database password in Supabase → **Project Settings → Database**. |
| `Database: can't connect (Tenant or user not found)` | The connection string was copied wrong. Copy the **Transaction pooler** one again. |
| `Database: connected, but tables are missing` | The setup step didn't run. Vercel → **Deployments → ⋯ → Redeploy**. |
| `SESSION_SECRET: missing or shorter than 32 characters` | Make the secret again with the PowerShell command in Step 3. |
| Any change to environment variables | Takes effect only after a **Redeploy**. |
| The site is very slow or "project paused" | Supabase paused it after 7 idle days. Log in to Supabase and click **Restore project**. |

---

## Optional: run the app on your own PC

You don't need this to play. It's handy later for trying changes before they go live, or for running the automated tests.

1. Install **Node.js LTS** from <https://nodejs.org> (the big green "LTS" button). Accept the defaults.
2. Install **Git for Windows** from <https://git-scm.com/download/win>. Accept the defaults.
3. (Recommended) Install **Visual Studio Code** from <https://code.visualstudio.com> to look at the files.
4. Open **Command Prompt** (Windows key → type `cmd`) and run these one at a time:
   ```bat
   cd %USERPROFILE%\Documents
   git clone https://github.com/GroudonMcL/Megegame-Test.git
   cd Megegame-Test
   npm install
   copy .env.example .env.local
   notepad .env.local
   ```
5. In Notepad, fill in the same three values you gave Vercel, then save and close it. Keep the `"quotes"` around `DATABASE_URL`, because without them a `#` in your password would be read as the start of a comment.
6. Start the app:
   ```bat
   npm run dev
   ```
   Open <http://localhost:3000> in your browser. Press **Ctrl+C** in the Command Prompt window to stop it.
7. Run the automated tests:
   ```bat
   npm test
   ```

> If you use **PowerShell** instead of Command Prompt and get "running scripts is disabled on this system", run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, answer `Y`, and try again.

Your PC copy uses the **same live database** as the website, so anything you create locally shows up online too.
