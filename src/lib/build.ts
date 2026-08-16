/**
 * Which build this is.
 *
 * A page served from a cache looks exactly like a fresh one. This app is mostly
 * a picture, so there is nothing on the screen that would tell you the phone is
 * still running last week's copy — and after a deploy that is exactly the
 * question worth answering. iOS in particular will hold on to an `index.html`
 * long after the assets it names have moved.
 *
 * Stamped in by Vite at build time; see `stamp()` in `vite.config.ts`. Tests and
 * the dev server have no stamp, and say so rather than inventing one.
 */

declare const __BUILD__: { commit: string; built: string } | undefined;

export interface Build {
  /** Short commit the build came from, or `unknown` where git was not there. */
  readonly commit: string;
  /** When it was built, as an ISO instant, or `null` when it was not a build. */
  readonly built: string | null;
}

export const BUILD: Build = read();

function read(): Build {
  // `typeof` rather than a plain reference: outside a Vite build the name is
  // not declared at all, and touching it would throw rather than be undefined.
  if (typeof __BUILD__ === 'undefined') {
    return { commit: 'dev', built: null };
  }

  return { commit: __BUILD__.commit, built: __BUILD__.built };
}

/**
 * The build, as one short line to put in a corner.
 *
 * Deliberately terse and deliberately not clever: a date you can compare to
 * when you last deployed, and a commit you can paste into a search. Rendered
 * from the viewer's own locale, since the only person reading it is holding the
 * phone.
 */
export function buildLine(build: Build = BUILD): string {
  if (!build.built) {
    return `${build.commit} · not a build`;
  }

  const when = new Date(build.built);

  if (Number.isNaN(when.getTime())) {
    return build.commit;
  }

  return `${build.commit} · ${when.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
