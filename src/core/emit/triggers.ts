/**
 * Start triggers that need a few lines of script in SMIL and CSS output: "visible" (start when
 * the SVG is half on screen) and "scroll" (SMIL: the scroll position sets the time; CSS uses a
 * scroll-driven animation instead, see Writer.finish). Both degrade to normal playback where
 * scripts don't run (<img>): the script holds the animation, not the markup.
 */

/** Where the scroll position runs the animation from start to end. */
export type ScrollRange = "visible" | "crossing" | "page";

export const SCROLL_RANGE_CODES: Record<ScrollRange, number> = { visible: 0, crossing: 1, page: 2 };

/**
 * Progress 0..1 of the scroll range, as a JS expression over `r` (the box's client rect), `v` (the
 * viewport height) and `w` (the window that scrolls). Matches CSS view timelines: "visible" is
 * `contain` (fully on screen, or covering the screen when taller), "crossing" is `cover` (from
 * entering at the bottom until it leaves at the top), "page" is the page's scroll position.
 * Shared with the player runtime (same formula in runtime.ts).
 */
const PROGRESS =
	"m==2?w.scrollY/Math.max(1,w.document.documentElement.scrollHeight-v):m==1?(v-r.top)/(v+r.height):(k=v-r.height)>0?(k-r.top)/k:k<0?r.top/k:r.top>0?0:1";

/** Holds the SVG (SMIL: its clock; CSS: a class that pauses the animations) until it is half on screen. */
export function visibleScript(svgId: string, css: boolean): string {
	const hold = css ? 's.classList.add("f2s-wait")' : "s.pauseAnimations()";
	const go = css ? 's.classList.remove("f2s-wait")' : "s.unpauseAnimations()";
	return (
		`(function(s){if(!s||!window.IntersectionObserver)return;${hold};` +
		`new IntersectionObserver(function(e,o){e=e[e.length-1];var h=e.rootBounds?e.rootBounds.height:innerHeight;` +
		`if(e.isIntersecting&&(e.intersectionRatio>=.5||e.intersectionRect.height>=h/2)){o.disconnect();${go}}},{threshold:[0,.25,.5]}).observe(s)})` +
		`(document.getElementById(${JSON.stringify(svgId)}))`
	);
}

/**
 * SMIL: the scroll position sets the document time (0..dur seconds). In an <object> or <iframe>
 * of the same origin the page around it scrolls: its position there counts. Without a page around
 * it (opened by itself, or a frame of another origin that can't be seen from inside) it just plays.
 */
export function scrollScript(svgId: string, range: ScrollRange, dur: number): string {
	return (
		`(function(s,d,m){if(!s)return;var w=window,h=null;try{h=w.frameElement}catch(x){}if(!h&&(w!==w.top||document.documentElement===s))return;if(h)w=w.parent;var b=h||s,q=0;s.pauseAnimations();` +
		`function u(){q=0;var r=b.getBoundingClientRect(),v=w.innerHeight,k,p=${PROGRESS};s.setCurrentTime(Math.min(1,Math.max(0,p))*d)}` +
		`function f(){if(!q){q=1;requestAnimationFrame(u)}}w.addEventListener("scroll",f,{capture:true,passive:true});w.addEventListener("resize",f);u()})` +
		`(document.getElementById(${JSON.stringify(svgId)}),${+dur.toFixed(4)},${SCROLL_RANGE_CODES[range]})`
	);
}

/** CSS: scroll-driven animations on the SVG's view timeline (or the page's scroll). Inline SVG only. */
export function scrollCss(svgId: string, range: ScrollRange): string {
	// after the animation rules (`#id .k1{animation:…}` resets the timeline; `[class]` ties on specificity)
	const name = `--${svgId}`;
	if (range === "page") return `#${svgId} [class]{animation-timeline:scroll(root)}`;
	return `#${svgId}{view-timeline:${name}}#${svgId} [class]{animation-timeline:${name}${range === "visible" ? ";animation-range:contain" : ""}}`;
}
