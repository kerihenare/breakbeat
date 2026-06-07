// The brief's seven content types verbatim, plus `other` as the explicit
// escape hatch. A null content type (not represented here) reads as
// "unclassified" at a terminal state.
export type ContentType =
	| "news"
	| "trade_publication"
	| "blog_post"
	| "press_release"
	| "social_post"
	| "newsletter"
	| "podcast"
	| "other";

export const CONTENT_TYPES: readonly ContentType[] = [
	"news",
	"trade_publication",
	"blog_post",
	"press_release",
	"social_post",
	"newsletter",
	"podcast",
	"other",
];
