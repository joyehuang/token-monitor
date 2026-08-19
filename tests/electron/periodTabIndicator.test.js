'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');
const css = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');

const tabsRule = css.match(/\n\.tabs \{([^}]*)\}/)[1];
const indicatorRule = css.match(/\n\.tab-indicator \{([^}]*)\}/)[1];

const PERIOD_TAB_COUNT = [...html.matchAll(/<button class="tab[^"]*" data-period=/g)].length;
const PADDING = Number(tabsRule.match(/--period-pad:\s*(\d+)px/)[1]);
const GAP = Number(tabsRule.match(/gap:\s*(\d+)(?:px)?/)[1]);

// The indicator is absolutely positioned and slides by a multiple of its own
// width, so its width has to equal one grid column exactly. Sizing it for a
// different count (upstream's three periods vs this fork's four) leaves it too
// wide and drifting further off with every tab — with no layout error to catch it.
test('the sliding indicator matches a grid column for every tab', () => {
  assert.match(
    tabsRule,
    /grid-template-columns:\s*repeat\(var\(--period-count\),/,
    'grid columns must be driven by --period-count, not a literal that can desync'
  );
  assert.equal(GAP, 0, 'the cells tile edge to edge; a column gap would have to be added back to the travel step');

  const fallbackCount = Number(tabsRule.match(/--period-count:\s*(\d+)/)[1]);
  assert.equal(fallbackCount, PERIOD_TAB_COUNT, '--period-count fallback must match the period buttons');

  for (const stripWidth of [180, 240, 317, 480]) {
    const column = (stripWidth - 2 * PADDING - (PERIOD_TAB_COUNT - 1) * GAP) / PERIOD_TAB_COUNT;
    // Mirrors the CSS: width: calc((100% - 2 * var(--period-pad)) / count)
    const indicator = (stripWidth - 2 * PADDING - (PERIOD_TAB_COUNT - 1) * GAP) / PERIOD_TAB_COUNT;
    assert.equal(indicator, column, `indicator width must equal a column at ${stripWidth}px`);
    for (let index = 0; index < PERIOD_TAB_COUNT; index += 1) {
      const columnLeft = PADDING + index * (column + GAP);
      // Mirrors the CSS: left: var(--period-pad) + translate3d(index * 100%)
      const indicatorLeft = PADDING + index * (indicator + GAP);
      assert.equal(indicatorLeft, columnLeft, `indicator must sit on tab ${index} at ${stripWidth}px`);
    }
  }
});

test('the indicator geometry is derived from --period-count, not a literal', () => {
  const width = indicatorRule.match(/width:\s*calc\(([^;]+)\);/)[1];
  assert.match(width, /var\(--period-count\)/);
  assert.doesNotMatch(width, /\/\s*\d+\s*\)\s*$/, 'a literal divisor desyncs from the tab count');
  assert.match(indicatorRule, /transform:\s*translate3d\(calc\(var\(--period-index\)/);
  assert.match(app, /setProperty\('--period-count', String\(tabs\.length/);
});

// The pill sits behind the labels, so any vertical mismatch reads as a second,
// misaligned edge around the active tab rather than as a layout bug.
test('the indicator is inset by the same padding as the tab cells', () => {
  for (const side of ['top', 'bottom', 'left']) {
    assert.match(
      indicatorRule,
      new RegExp(`${side}:\\s*var\\(--period-pad\\)`),
      `indicator ${side} must track the strip padding so the pill covers exactly one cell`
    );
  }
  assert.match(tabsRule, /padding:\s*var\(--period-pad\)/);
  assert.match(cssRule(css, '.tab'), /height:\s*100%/, 'tabs fill the row so the pill and the labels share one box');
});

// .tab is in the shared control rule (.icon-button, .refresh-button, .tab, ...),
// which hands it a 1px border and backdrop-filter: blur(18px). The blur is
// clipped to the tab's padding box, so on top of the indicator it paints a
// second rounded edge 1px inside the pill — a doubled border, not a layout bug.
test('tabs paint no surface of their own on top of the indicator', () => {
  const tabRule = cssRule(css, '.tab');
  assert.match(tabRule, /border:\s*0/, 'the shared control border would double the pill edge');
  assert.match(tabRule, /(?<!-webkit-)backdrop-filter:\s*none/, 'the shared control blur would double the pill edge');
  assert.match(tabRule, /-webkit-backdrop-filter:\s*none/);
  assert.match(tabRule, /background:\s*transparent/);
});

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}
