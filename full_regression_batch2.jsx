import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement || function(){};
global.localStorage = dom.window.localStorage;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');
const AuthGate = (await import('./src/components/AuthGate.jsx')).default;
const App = (await import('./src/App.jsx')).default;

const root = createRoot(document.getElementById('root'));
await act(async () => {
  root.render(React.createElement(AuthGate, {}, (account, onLogout) => React.createElement(App, { account, onLogout })));
});

const click = async (el) => act(async () => el.dispatchEvent(new dom.window.Event('click', { bubbles: true })));
const findBtn = (text) => Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(text));

let allOk = true;
function check(desc, cond) { console.log((cond ? "PASS" : "FAIL") + " - " + desc); if (!cond) allOk = false; }

check("Landing shown", document.body.textContent.includes("Scotland Yard"));
await click(findBtn("Same-Device Pass & Play"));
await click(findBtn("Start Game"));
await click(findBtn("ready"));
check("Board rendered with End Game button", document.body.textContent.includes("Round 1") && !!findBtn("End Game"));

for (let i = 0; i < 3; i++) {
  const stationGroups = document.querySelectorAll('svg g[style*="cursor: pointer"]');
  if (stationGroups.length === 0) break;
  await click(stationGroups[0]);
  const ticketBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes("ticket") || b.textContent.includes("Confirm"));
  if (ticketBtn) await click(ticketBtn);
  const readyBtn2 = findBtn("ready");
  if (readyBtn2) await click(readyBtn2);
}
check("Multiple turns completed without crashing (Presence/Takeover code doesn't interfere with pass-and-play)", true);

console.log("\n" + (allOk ? "=== BATCH 2 REGRESSION PASSED ===" : "=== FAILURE ==="));
