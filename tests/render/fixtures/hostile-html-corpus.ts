// Hostile and tricky HTML for the sanitizer regression suite
// (tests/render/html-sanitizer-corpus.test.ts). Threat model: V-1, V-3, R-16.
//
// Every entry is fed through `sanitizeEmailHtml`. Hosts use the reserved
// `h.example` name; none of this ever touches the network. Add a payload here
// whenever a new bypass is found or a sanitizer dependency is upgraded.

export interface CorpusEntry {
  html: string;
  /** References a remote resource, so `allowRemote: false` must set the banner flag. */
  remote?: true;
  /** A known, tracked violation. See the T-3 section of docs/security/threat-model.md. */
  gap?: "T-3";
}

const p = (html: string, extra: Omit<CorpusEntry, "html"> = {}): CorpusEntry => ({ html, ...extra });

export const HOSTILE_CORPUS: Record<string, CorpusEntry> = {
  // --- threat model T-3 / PoC F: remote content the blocker has missed
  tabScheme: p(`<img src="ht\ttp://h.example/p.png">`, { remote: true, gap: "T-3" }),
  newlineScheme: p(`<img src="ht\ntp://h.example/p.png">`, { remote: true, gap: "T-3" }),
  feImageHref: p(
    `<svg><filter id=f><feImage href="http://h.example/p.png"/></filter><rect filter="url(#f)" width=5 height=5/></svg>`,
    { remote: true, gap: "T-3" },
  ),
  feImageXlink: p(
    `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><feImage xlink:href="http://h.example/p.png"/></svg>`,
    { remote: true },
  ),
  svgFilterUrl: p(`<svg><rect filter="url(http://h.example/x.svg#f)" width=5 height=5/></svg>`, { remote: true }),
  svgMask: p(`<svg><rect mask="url(http://h.example/x.svg#f)"/></svg>`, { remote: true }),
  svgImage: p(`<svg><image href="https://h.example/a.png"/></svg>`, { remote: true }),
  // DOMPurify deletes <use> outright, so nothing remote survives and there is nothing to flag.
  svgUse: p(`<svg><use href="https://h.example/a.svg#x"/></svg>`),
  svgUseXlink: p(`<svg><use xlink:href="https://h.example/a.svg#x"/></svg>`),

  // --- remote content the blocker handles
  img: p(`<img src="https://h.example/a.png" alt="x">`, { remote: true }),
  imgProtoRel: p(`<img src="//h.example/a.png">`, { remote: true }),
  imgSrcset: p(`<img src="data:image/png;base64,AAAA" srcset="https://h.example/a.png 2x">`),
  videoPoster: p(`<video poster="https://h.example/p.png"><source src="https://h.example/v.mp4"></video>`, { remote: true }),
  audio: p(`<audio src="https://h.example/a.mp3"></audio>`, { remote: true }),
  inputImage: p(`<input type=image src="https://h.example/a.png">`, { remote: true }),
  bgAttr: p(`<table background="https://h.example/bg.png"><tr><td>x</td></tr></table>`),
  styleAttrUrl: p(`<div style="background:url(https://h.example/a.png)">x</div>`, { remote: true }),
  styleAttrImageSet: p(`<div style="background:image-set(url(https://h.example/a.png) 1x)">x</div>`, { remote: true }),
  styleAttrComment: p(`<div style="background:url(/*c*/'https://h.example/a.png')">x</div>`, { remote: true }),
  styleBlock: p(`<style>body{background:url(https://h.example/a.png)}</style><p>x</p>`, { remote: true }),
  styleImport: p(`<style>@import url(https://h.example/a.css);</style><p>x</p>`, { remote: true }),
  linkTag: p(`<link rel=stylesheet href="https://h.example/a.css"><p>x</p>`),
  metaRefresh: p(`<meta http-equiv=refresh content="0;url=https://h.example/"><p>x</p>`),
  baseTag: p(`<base href="https://h.example/"><a href="x">x</a>`),

  // --- script and handler XSS
  scriptTag: p(`<script>alert(1)</script><p>x</p>`),
  imgOnerror: p(`<img src=x onerror=alert(1)>`),
  svgOnload: p(`<svg onload=alert(1)></svg>`),
  jsHref: p(`<a href="javascript:alert(1)">x</a>`),
  jsHrefEntity: p(`<a href="&#106;avascript:alert(1)">x</a>`),
  jsHrefTab: p(`<a href="java\tscript:alert(1)">x</a>`),
  vbHref: p(`<a href="vbscript:msgbox(1)">x</a>`),
  dataHtmlHref: p(`<a href="data:text/html,<script>alert(1)</script>">x</a>`),
  dataSvgImg: p(
    `<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">`,
  ),
  iframe: p(`<iframe src="https://h.example/"></iframe>`),
  iframeSrcdoc: p(`<iframe srcdoc="<script>alert(1)</script>"></iframe>`),
  object: p(`<object data="https://h.example/x.swf"></object>`),
  embed: p(`<embed src="https://h.example/x.swf">`),
  form: p(`<form action="https://h.example/"><input name=a><button formaction="https://h.example/">x</button></form>`),

  // --- mutation XSS (output must stay inert after the renderer reparses it)
  noscriptMxss: p(`<noscript><p title="</noscript><img src=x onerror=alert(1)>">`),
  styleInSvg: p(`<svg><style><img src=x onerror=alert(1)></style></svg>`),
  styleInMath: p(
    `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">`,
  ),
  mathAnnotation: p(`<math><annotation-xml encoding="text/html"><style><img src=x onerror=alert(1)></style></annotation-xml></math>`),
  svgForeign: p(`<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>`),
  textareaBreakout: p(`<textarea></textarea><img src=x onerror=alert(1)>`),
  titleBreakout: p(`<title></title><img src=x onerror=alert(1)>`),
  attrBreakoutComment: p(`<div title="--><img src=x onerror=alert(1)>">x</div>`),
  attrBreakoutBracket: p(`<p title="]]><img src=x onerror=alert(1)>">x</p>`),
  attrBreakoutStyleClose: p(`<p title="</style><img src=x onerror=alert(1)>">x</p>`),
  attrBreakoutScriptClose: p(`<p title="</script><img src=x onerror=alert(1)>">x</p>`),
  attrBreakoutTextarea: p(`<p title="</textarea><img src=x onerror=alert(1)>">x</p>`),
  attrBreakoutXmp: p(`<p title="</xmp><img src=x onerror=alert(1)>">x</p>`),
  attrBreakoutNoembed: p(`<p title="</noembed><img src=x onerror=alert(1)>">x</p>`),
  attrBreakoutIframe: p(`<p title="</iframe><img src=x onerror=alert(1)>">x</p>`),
  commentEarly: p(`<!--><img src=x onerror=alert(1)>-->`),
  commentBang: p(`<!--!><img src=x onerror=alert(1)>-->`),
  commentNested: p(`<!-- <!-- --> <img src=x onerror=alert(1)> -->`),
  cdataHtml: p(`<![CDATA[<img src=x onerror=alert(1)>]]>`),
  cdataSvg: p(`<svg><![CDATA[<img src=x onerror=alert(1)>]]></svg>`),
  nestedForms: p(`<form><form><input name=x></form></form>`),
  selectTemplate: p(`<select><template><img src=x onerror=alert(1)></template></select>`),
  selectedcontent: p(
    `<select><option selected><img src=x onerror=alert(1)></option><button><selectedcontent></selectedcontent></button></select>`,
  ),
  details: p(`<details open ontoggle=alert(1)><summary>x</summary></details>`),

  // --- DOM clobbering
  clobberForm: p(`<form id=x><input name=attributes></form><img src=x onerror=alert(1)>`),
  clobberNodeName: p(`<form><input name=nodeName></form>`),
  clobberRemoveAttrNode: p(`<form><input name=removeAttributeNode></form><p onclick=alert(1)>x</p>`),
  clobberId: p(`<a id=cookie>x</a><img name=body>`),

  // --- template markers (the plugin does not enable SAFE_FOR_TEMPLATES; output must still be inert)
  tmplMustache: p(`<p>{{constructor.constructor('alert(1)')()}}</p>`),
  tmplSplit: p(`<p>{<b></b>{x}<b></b>}</p>`),
  tmplNul: p(`<p>{\u0000{x}\u0000}</p>`),
  tmplErb: p(`<p>&lt;%= 7*7 %&gt;</p>`),
  tmplLit: p(`<p>\${alert(1)}</p>`),

  // --- forged data-blocked-* markers (plugin specific: restoreBlockedContent must not promote them)
  forgedMarkerSrc: p(`<img data-blocked-src="https%3A%2F%2Fh.example%2Fa.png">`),
  forgedMarkerHref: p(`<svg><use data-blocked-href="https%3A%2F%2Fh.example%2Fa.svg"/></svg>`),
  forgedMarkerJs: p(`<img data-blocked-src="javascript%3Aalert(1)">`),

  // --- names that are attributes but were once in DOMPurify's SVG tag allow-list (removed in 3.4.18)
  htmlEnterkeyhint: p(`<input enterkeyhint="send" inputmode="numeric" part="p" exportparts="a:b">`),
  svgEnterkeyhintAttr: p(`<svg><rect enterkeyhint="go" inputmode="text" part="p" exportparts="x:y"/></svg>`),
  svgBogusTags: p(`<svg><enterkeyhint/><exportparts/><inputmode/><part/><rect/></svg>`),

  // --- links and schemes
  anchorBasic: p(`<a href="https://example.com/x?y=1">link</a>`),
  anchorMailto: p(`<a href="mailto:a@example.com">m</a>`),
  anchorTel: p(`<a href="tel:+15551234">t</a>`),
  anchorCid: p(`<img src="cid:abc123">`),
  anchorFile: p(`<a href="file:///etc/passwd">f</a>`),
  anchorObsidian: p(`<a href="obsidian://open?vault=x">o</a>`),
  anchorNoHref: p(`<a name="x">n</a>`),
  anchorTitle: p(`<a href="https://example.com/" title="keep">t</a>`),

  // --- realistic mail and degenerate input
  newsletter: p(
    `<table width="600" cellpadding="0" style="font-family:Arial;color:#333"><tr><td><h1 style="margin:0">Hello</h1><p>Body <b>bold</b> <i>ital</i> <a href="https://example.com/u?x=1">link</a></p><img src="https://track.example/o.gif" width="1" height="1"><ul><li>a</li><li>b</li></ul></td></tr></table>`,
    { remote: true },
  ),
  empty: p(``),
  plainText: p(`just text & <b>bold</b>`),
  unclosed: p(`<div><p><b>unclosed`),
  deepNest: p("<div>".repeat(300) + "x" + "</div>".repeat(300)),
  hugeAttr: p(`<p title="${"a".repeat(5000)}">x</p>`),
  nullBytes: p(`<img src="https://h.example/a.png\u0000" onerror=alert(1)>`),
  unicodeSpoof: p(`<a href="https://exаmple.com/">x</a>`),
};

export const CORPUS_ENTRIES = Object.entries(HOSTILE_CORPUS);
export const KNOWN_GAP_ENTRIES = CORPUS_ENTRIES.filter(([, e]) => e.gap);
