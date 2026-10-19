// The dark theme is the default. The light theme, if a player picked it, is
// kept in localStorage under THEME_KEY and applied by THEME_SCRIPT, which runs
// in <head> before anything renders, so a light-theme user never sees a dark flash.

export const THEME_KEY = "theme";

export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
