# Setting up your own workspace

This app runs on **your own Firebase project**, so your data stays in your Google account. Setup takes about 10 minutes.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project.
2. **Build → Authentication** → Get started → enable the **Google** provider.
3. **Build → Firestore Database** → Create database (production mode).
4. *(Optional)* **Build → Storage** → Get started, for profile pictures.
5. **Project settings → General → Your apps** → add a **Web app (`</>`)**. Copy the `firebaseConfig` it shows you.

> Use the **Web app** config. Never use a *service account* key, which contains a private key. The app and the setup script both refuse one.

## 2. Connect the app

Save the config as `firebase-config.json`. Plain JSON works, and so does the JS snippet exactly as Firebase shows it. You can add an optional `"appName"` key to name your workspace:

```json
{
  "appName": "Acme Studio",
  "apiKey": "…",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project",
  "storageBucket": "your-project.firebasestorage.app",
  "messagingSenderId": "…",
  "appId": "…"
}
```

Then run:

```bash
npm install
npx firebase-tools login
npm run setup -- path/to/firebase-config.json
```

This command does three things:

- copies the config to `public/firebase-config.json`, which the app reads at startup
- points `.firebaserc` at your project
- deploys the security rules and indexes

If you didn't enable Storage, the deploy step fails. Enable Storage first, or run the command with `--no-deploy` and deploy only Firestore: `npx firebase-tools deploy --only firestore`.

**No terminal yet?** Open the app without a config file and you get a **Setup screen**. Upload or paste your config there to try the app in that browser. That screen can also download a ready-made `firebase-config.json` for you. The security rules still have to be deployed with `npm run setup` before your team uses the app.

## 3. Deploy and claim the workspace

1. `npm run build`, then host the `dist/` folder. For Firebase Hosting: `npx firebase-tools deploy --only hosting`.
2. **Authentication → Settings → Authorized domains**: add the domain you host the app on.
3. Open the app and **sign in first**. The first account to sign in becomes the workspace owner. Only one account can ever claim a workspace.
4. Invite your team from **Admin → Team**.

## Switching projects

Open the app with `?setup` at the end of the URL to clear a config saved in the browser. A deployed `public/firebase-config.json` always takes priority over a browser-saved config.
