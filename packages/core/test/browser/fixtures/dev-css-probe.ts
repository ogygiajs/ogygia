// Importing this module adds a known style, as a dev region's module injects its scoped <style>.
const s = document.createElement('style');
s.setAttribute('data-og-dev-probe', '');
s.textContent = '.og-dev-probe{color:rgb(0, 128, 0)}';
document.head.appendChild(s);
