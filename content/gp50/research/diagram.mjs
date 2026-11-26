// Draws an architecture as a signal-flow block diagram (inline SVG), with the usual DSP symbols:
// boxes for filters and nonlinearities, triangles for gains, a circle with + for a summing junction,
// and a dot where the signal splits into parallel branches.
//
// An architecture is a list of block names. {"parallel": [[...], [...]]} is a group of branches that all
// receive the same signal; the block right after it must be the summing junction that adds them back.
// Each block's look comes from milestones.json "blocks": {label, shape: "gain" | "sum" | (box)}.

const CHAR = 7.2;      // width of one character of the 12px monospace font
const BOX_H = 24;      // box height
const ARROW = 22;      // length of the arrow between two blocks
const LANE = 16;       // space for the split and merge lines around parallel branches
const ROW_GAP = 10;    // vertical gap between parallel branches
const R = 9;           // radius of the summing junction

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Each layout function returns {w, h, cy, draw(x, y)}: size, height of the signal line inside the
// item (cy, from its top), and a function returning the SVG for the item placed with its top-left at (x, y).

function block(name, blocks) {
  const info = blocks[name] ?? {};
  const text = info.label ?? name;
  const attrs = info.text ? ` tabindex="0" data-block="${escape(name)}"` : '';
  if (info.shape === 'gain') {
    const w = text.length * CHAR + 24, h = 28;
    return {w, h, cy: h / 2, draw: (x, y) => `<g class="node"${attrs}>` +
      `<polygon points="${x},${y} ${x + w},${y + h / 2} ${x},${y + h}"/>` +
      `<text x="${x + 6}" y="${y + h / 2 + 4}">${escape(text)}</text></g>`};
  }
  if (info.shape === 'sum') {
    return {w: 2 * R, h: 2 * R, cy: R, draw: (x, y) => `<g class="node"${attrs}>` +
      `<circle cx="${x + R}" cy="${y + R}" r="${R}"/>` +
      `<path d="M${x + R - 5} ${y + R}h10M${x + R} ${y + R - 5}v10" class="wire"/></g>`};
  }
  const w = text.length * CHAR + 16;
  return {w, h: BOX_H, cy: BOX_H / 2, draw: (x, y) => `<g class="node"${attrs}>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${BOX_H}"/>` +
    `<text x="${x + 8}" y="${y + BOX_H / 2 + 4}">${escape(text)}</text></g>`};
}

const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" class="wire" marker-end="url(#arrowhead)"/>`;

// Parallel branches and the summing junction that follows them, drawn as one item.
function parallelSum(group, sumName, blocks) {
  const rows = group.parallel.map(b => sequence(b, blocks));
  const inner = Math.max(...rows.map(r => r.w));
  const h = rows.reduce((total, r) => total + r.h, 0) + ROW_GAP * (rows.length - 1);
  const sum = block(sumName, blocks);
  const w = LANE + inner + LANE + sum.w;
  return {w, h, cy: h / 2, draw(x, y) {
    const cy = y + h / 2, sx = x + LANE + inner + LANE, scx = sx + R;
    let svg = '', top = y;
    const lines = rows.map(r => { const at = top; top += r.h + ROW_GAP; return {r, at, line: at + r.cy}; });
    svg += `<path d="M${x} ${lines[0].line}V${lines.at(-1).line}" class="wire"/><circle cx="${x}" cy="${cy}" r="3" class="dot"/>`;
    for (const {r, at, line} of lines) {
      svg += arrow(x, line, x + LANE, line) + r.draw(x + LANE, at);
      const end = x + LANE + r.w;
      // Into the junction: from above, from below, or straight in from the left.
      if (Math.abs(line - cy) < 1) svg += arrow(end, line, sx, line);
      else {
        const edge = line < cy ? cy - R : cy + R;
        svg += `<path d="M${end} ${line}H${scx}" class="wire"/>` + arrow(scx, line, scx, edge);
      }
    }
    return svg + sum.draw(sx, cy - R);
  }};
}

function sequence(nodes, blocks) {
  const items = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (typeof n === 'string') items.push(block(n, blocks));
    else items.push(parallelSum(n, nodes[++i], blocks));  // the next node is the junction
  }
  const cy = Math.max(...items.map(item => item.cy));
  const below = Math.max(...items.map(item => item.h - item.cy));
  const w = items.reduce((total, item) => total + item.w, 0) + ARROW * (items.length - 1);
  return {w, h: cy + below, cy, draw(x, y) {
    let svg = '', at = x;
    items.forEach((item, i) => {
      if (i) { svg += arrow(at, y + cy, at + ARROW, y + cy); at += ARROW; }
      svg += item.draw(at, y + cy - item.cy);
      at += item.w;
    });
    return svg;
  }};
}

export function diagram(nodes, blocks) {
  const s = sequence(nodes, blocks), pad = 6;
  const w = s.w + 2 * pad + ARROW, h = s.h + 2 * pad;
  // A short arrow in at the left and out at the right, like any block diagram's input and output.
  return `<svg class="diagram" width="${w + ARROW}" height="${h}" viewBox="0 0 ${w + ARROW} ${h}" role="img" aria-label="Architecture diagram">` +
    `<defs><marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">` +
    `<path d="M0 0L8 4L0 8z" class="head"/></marker></defs>` +
    arrow(pad, pad + s.cy, pad + ARROW, pad + s.cy) + s.draw(pad + ARROW, pad) +
    arrow(pad + ARROW + s.w, pad + s.cy, pad + 2 * ARROW + s.w, pad + s.cy) + '</svg>';
}
