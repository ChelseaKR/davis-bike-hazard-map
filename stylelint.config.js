// G10 (static) — CSS logical properties for RTL readiness.
// INTERNATIONALIZATION-STANDARD.md §4 (G10) + §8: layout MUST use CSS logical
// properties so the map/list UI mirrors correctly when an RTL locale (ar/he)
// ships. Replicates the validated personal-site pilot (ChelseaKR/personal-site
// PR #13).
//
// SCOPE (locked): this gate enforces the *inline* (writing-direction) axis only —
// the axis that flips under RTL. It flags physical `left`/`right`,
// `margin-/padding-/border-left|right`, and physical `text-align`/`float`/`clear`
// values, requiring `inset-inline-*`, `margin-inline-*`, `padding-inline-*`,
// `border-inline-*`, and `text-align: start|end`.
//
// The block (vertical) axis and box sizing do NOT flip under RTL, so `top`/
// `bottom`, `margin-/padding-/border-top|bottom`, and `width`/`height` are
// intentionally left as physical properties via `except` — converting them would
// be churn with no RTL benefit and is out of G10's scope. When an RTL locale
// ships, the deferred dynamic ar/he Playwright mirror smoke (see docs/I18N.md)
// verifies the runtime result; this static gate keeps new physical inline CSS
// from landing in the meantime.
//
// Only src/**/*.css is linted (the app's own stylesheet). Leaflet's bundled CSS
// lives in node_modules and is out of scope — its map-control glyphs are handled
// by Leaflet's own RTL support, not this gate.
export default {
  plugins: ['stylelint-use-logical'],
  rules: {
    'csstools/use-logical': [
      'always',
      {
        except: [
          // Block (vertical) axis — unaffected by inline direction / RTL.
          /^(top|bottom)$/,
          /^margin-(top|bottom)$/,
          /^padding-(top|bottom)$/,
          /^border-(top|bottom)(-|$)/,
          // Box sizing — physical width/height do not mirror under RTL.
          /^(min-|max-)?(width|height)$/,
          /^overflow-(x|y)$/,
        ],
      },
    ],
  },
};
