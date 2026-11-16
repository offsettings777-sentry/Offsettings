// 1) Firebase console -> Project settings -> General -> "Your apps" -> Web app (</>)
//    Copy apiKey, authDomain and projectId here.
// 2) Firebase console -> Authentication -> Settings -> Authorized domains:
//    add the domain where you host this site.
export const firebaseConfig = {
  apiKey: "AIzaSyD7BwrSPRZYnmRmtxIFXZkNZsGXg2IhJZg",
  authDomain: "offsettings-3008c.firebaseapp.com",
  projectId: "offsettings-3008c",
};

// true : after a fake shutdown ends, keep showing the last location it shared
//        (clearly labelled as old).
// false: show a location only while a fake shutdown is active.
export const SHOW_OLD_LOCATION = true;
