// A simple Web Component for inline footnotes.
// Usage: <inline-footnote>Your footnote text here</inline-footnote>

let footnoteCounter = 0;

class InlineFootnote extends HTMLElement {
  connectedCallback() {
    // Prevent double processing if re-connected
    if (this.hasAttribute('processed')) return;
    this.setAttribute('processed', 'true');

    footnoteCounter++;
    const index = footnoteCounter;

    // Save the footnote text that the user wrote inside the tag
    const noteHTML = this.innerHTML;

    // Replace the custom element's content with just the numbered link
    this.innerHTML = `
      <sup id="ref-${index}">
        <a href="#note-${index}" class="footnote-ref" role="doc-noteref" aria-describedby="note-${index}">[${index}]</a>
      </sup>
    `;
    this.style.display = 'inline'; /* Ensure it behaves like a normal inline element */

    // Find or create the list of footnotes at the bottom of the page
    let container = document.getElementById('footnotes-container');
    if (!container) {
      container = document.createElement('footer');
      container.id = 'footnotes-container';
      container.setAttribute('role', 'doc-endnotes');
      
      // Minimal structure: a horizontal line and an ordered list
      container.innerHTML = '<hr><ol id="footnotes-list"></ol>';
      
      // Try to append it to the end of the article, main, or body
      const contentRoot = document.querySelector('article') || document.querySelector('main') || document.body;
      contentRoot.appendChild(container);
    }

    const list = container.querySelector('#footnotes-list');

    // Create the list item at the bottom with the backlink
    const li = document.createElement('li');
    li.id = `note-${index}`;
    li.innerHTML = `${noteHTML} <a href="#ref-${index}" role="doc-backlink" aria-label="Back to content" style="text-decoration: none;">↩</a>`;
    list.appendChild(li);
  }
}

customElements.define('inline-footnote', InlineFootnote);
