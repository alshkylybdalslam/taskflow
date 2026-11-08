'use strict';

/* Apply the saved theme before first paint — no flash of the wrong theme.
   Kept as an external file (rather than an inline <script>) so the
   Content-Security-Policy can stay at script-src 'self'. */
try {
  document.documentElement.dataset.theme = localStorage.getItem('tf-theme') || 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}
