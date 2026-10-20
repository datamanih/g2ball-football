import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { GlassesApp } from './glasses';
import { mountSettings } from './settings';
import { initStore } from './store';

// Dev-only: ?reset clears the resume point so test runs start on the home menu.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('reset')) localStorage.removeItem('g2football.resume.v1');
async function boot() {
  const status = document.getElementById('status')!;
  const ver = document.getElementById('appVersion');
  if (ver) ver.textContent = `Version ${__APP_VERSION__}`;
  status.textContent = 'Loading your saved teams…';
  // Outside the Even app (plain browser) the bridge never arrives; the settings page still works from localStorage.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
  const bridge = await Promise.race([waitForEvenAppBridge(), timeout]);
  await initStore(bridge);          // read saved favourites from the Even app's storage before anything renders
  // Dev-only: ?demo seeds five favourites, including a manual Sunday league team, for screenshots and testing.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    const { seedDemo } = await import('./demo');
    await seedDemo(new URLSearchParams(location.search).get('demo') === 'live');
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('devbadge')) {
    const { devBadge } = await import('./demo');
    await devBadge(new URLSearchParams(location.search).get('devbadge')!, new URLSearchParams(location.search).has('invert'));
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('devcustom')) {
    const { devCustom } = await import('./demo');
    await devCustom(new URLSearchParams(location.search).get('devcustom')!);
  }
  mountSettings();
  // Dev-only: ?devpick=gMethod:apify,apLoad → set a select's value / click a button, in order, before scrolling.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('devpick')) {
    let t = 1500;
    for (const step of new URLSearchParams(location.search).get('devpick')!.split(',')) {
      setTimeout(() => {
        const [id, v] = step.split(':'), el = document.getElementById(id) as HTMLSelectElement | HTMLButtonElement | null;
        if (!el) return;
        if (v !== undefined && 'value' in el) { (el as HTMLSelectElement).value = v === '#1' ? (el as HTMLSelectElement).options[1]?.value ?? '' : v; el.dispatchEvent(new Event('change')); }
        else el.click();
      }, t);
      t += 2500;
    }
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('scroll')) setTimeout(() => document.getElementById(new URLSearchParams(location.search).get('scroll')!)?.scrollIntoView(), 2500);
  if (!bridge) status.textContent = 'Glasses not connected — open this inside the Even Realities app or the simulator.';
  else {
    if (status.textContent === 'Loading your saved teams…') status.textContent = '';
    await new GlassesApp(bridge).start();
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('devsave')) {
      const { devSave } = await import('./demo');
      devSave(Number(new URLSearchParams(location.search).get('devsave') || 3));
    }
  }
}
void boot();
