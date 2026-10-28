# Turn Atomshade into an Android app (Capacitor)

The app is a thin shell that opens your Vercel website, so every website update reaches the app without re-publishing.
You need: Node (you have it), Android Studio (free, developer.android.com/studio), and your Vercel link.

## One-time setup (in your project folder, in a terminal)
1. Open capacitor.config.json and replace https://YOUR-LINK.vercel.app with your real Vercel link.
2. Run these, one at a time:
      npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/app @capacitor/browser
      npx cap add android
      npx cap sync
3. Open  android/app/src/main/AndroidManifest.xml  and make two edits:
   a) Just above  <application  add:
        <uses-permission android:name="android.permission.CAMERA" />
        <uses-permission android:name="android.permission.RECORD_AUDIO" />
        <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
   b) Inside the  <activity ...MainActivity>  block, after its existing <intent-filter>, add:
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="atomshade" android:host="auth-callback" />
        </intent-filter>
4. Supabase -> Authentication -> URL Configuration -> Redirect URLs -> add:   atomshade://auth-callback
5. Run  npx cap open android  (opens Android Studio). Plug in your phone (USB debugging on) and press the green Play button.

## How login works in the app
Google refuses to sign in inside an app's built-in browser. So the app opens your phone's real browser for Google,
then Google sends you back through atomshade://auth-callback and the app finishes the login. Email links work the same way.

## Notifications in the app (NOT done yet)
The website notifications (done) do not work inside an Android app shell. The app needs Firebase push:
you create a free Firebase project and add the Android app. I will give you exact steps then, and tell you which values are safe to share.
That is the next step after the shell runs.

## Honest warnings
- Please test Google login in the app first. It depends on the app exposing its Browser/App parts to the website; if the
  button does nothing, tell me what you see and I will switch to bundling the Capacitor code (a small change).
- Google Play can reject apps that only wrap a website. Native push notifications and the camera/call features help; also
  add a privacy policy page and an in-app way to delete an account before you publish.
- Publishing on Google Play: one-time $25 fee. iPhone needs a Mac and $99 a year.
