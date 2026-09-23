/** Opens the OS print dialog on a standalone HTML document via a hidden
 *  iframe, so "Save as PDF" works without printing the whole app window.
 *
 *  `srcdoc` is set BEFORE the iframe is inserted into the document.
 *  Appending first and setting `srcdoc` after causes the iframe to briefly
 *  navigate to `about:blank`, firing a premature `load` event for that empty
 *  document — which this function's `load` listener would print instead of
 *  the real content, producing a blank page. */
export function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  const cleanup = (): void => iframe.remove();
  iframe.addEventListener(
    "load",
    () => {
      const win = iframe.contentWindow;
      if (!win) return cleanup();
      win.addEventListener("afterprint", cleanup);
      win.focus();
      win.print();
      // Some platforms never fire `afterprint` for a printed-to-PDF save.
      setTimeout(cleanup, 60_000);
    },
    { once: true },
  );
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
