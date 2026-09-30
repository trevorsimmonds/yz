# Yahtzee

Single-player Yahtzee. It installs on Android from Chrome and works offline. No server needed.

## Put it online (pick one, both free)

### Option A: Netlify Drop (easiest, about 2 minutes)
1. Unzip `yahtzee.zip` on your Mac. You'll get a `yahtzee` folder.
2. Go to https://app.netlify.com/drop and drag the **`yahtzee` folder** onto the page.
3. Netlify gives you a link like `https://something-random.netlify.app`.
   Create a free account (Netlify prompts you) so the site isn't deleted after an hour.

### Option B: GitHub Pages
1. Create a new public repository on GitHub, e.g. `yahtzee`.
2. Choose **Add file → Upload files**, drag in everything *inside* the `yahtzee` folder (including the `icons` folder), and commit.
3. Go to **Settings → Pages → Branch: main / (root) → Save**.
4. After about a minute your link is `https://<your-username>.github.io/yahtzee/`.

## Install on your Android phone
1. Open the link in **Chrome** on your phone.
2. Tap **⋮ → Add to Home screen → Install**.
3. Launch it from the new Yahtzee icon. It runs full-screen and works without internet from then on.

## Test on your Mac
- Open the same link in Chrome or Safari and resize the window to see the phone and desktop layouts.
- In Chrome, press **Cmd+Option+I**, then click the phone/tablet icon to preview exact Android screen sizes.
- To run it offline on the Mac without hosting it: open Terminal in the `yahtzee` folder, run
  `python3 -m http.server 8000`, and visit http://localhost:8000.
  (Double-clicking `index.html` also plays, but the offline/install features won't be active.)

## Updating later
If you change any file, bump the version in `sw.js` (`yahtzee-v11` → `yahtzee-v12`) and the
little version label next to the title in `index.html`, then push. The app loads fresh files
whenever it has internet, so the label tells you which version you're playing.

## Files
- `index.html`, `style.css`, `app.js`: the game
- `manifest.webmanifest`, `sw.js`, `icons/`: install and offline support
- `strategy-table.bin`: precomputed dice-strategy data used for hold suggestions and
  auto-scoring (see `tools/build-strategy-table.js` for how it's generated — only needs
  re-running if the scoring rules ever change)
