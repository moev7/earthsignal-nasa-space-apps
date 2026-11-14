import type { ComponentProps } from 'react';

/**
 * Use browser navigation between pages. The installed Vinext Link interceptor
 * cancels clicks without completing the route change in the standalone build.
 * Native anchors also retain query strings, fragments, Back and new-tab clicks.
 */
export function SiteLink(props: ComponentProps<'a'> & { href: string }) {
  return <a {...props} />;
}
