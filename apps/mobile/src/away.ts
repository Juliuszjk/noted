// App lock "after time in the background" must not count the times Noted itself sends the
// user to another screen and expects them back: a file or folder picker, the share menu, a
// file opened in another app. Those calls say so first (goingAway); a background that starts
// within a few seconds after that does not lock the app.
let awayAt = 0;
export const goingAway = () => { awayAt = Date.now(); };
export const backgroundWasIntended = (): boolean => Date.now() - awayAt < 4000;
