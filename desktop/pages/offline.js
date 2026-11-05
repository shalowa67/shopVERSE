const target = new URLSearchParams(location.search).get('target') || '';
const retry = () => window.shopverseDesktop.retry(target);

document.getElementById('retry').addEventListener('click', retry);
// Try again automatically as soon as the connection comes back.
window.addEventListener('online', retry);
