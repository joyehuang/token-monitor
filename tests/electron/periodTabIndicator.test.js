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
const PADDING = Number(tabsRule.match(/padding:\s*(\d+)px/)[1]);
const GAP = Number(tabsRule.match(/gap:\s*(\d+)px/)[1]);

// The indicator is absolutely positioned and slides by a multiple of its own
// width, so its width has to equal one grid column exactly. Sizing it for a
// different count (upstream's three periods vs this fork's four) leaves it too
// wide and drifting further off with every tab — with no layout error to catch it.
test('the sliding indicator matches a grid column for every tab', () => {
  const columnCount = Number(tabsRule.match(/grid-template-columns:\s*repeat\((\d+),/)[1]);
  assert.equal(columnCount, PERIOD_TAB_COUNT, 'grid column count must match the period buttons in index.html');

  const fallbackCount = Number(tabsRule.match(/--period-count:\s*(\d+)/)[1]);
  assert.equal(fallbackCount, PERIOD_TAB_COUNT, '--period-count fallback must match the period buttons');

  for (const stripWidth of [180, 240, 317, 480]) {
    const column = (stripWidth - 2 * PADDING - (PERIOD_TAB_COUNT - 1) * GAP) / PERIOD_TAB_COUNT;
    // Mirrors the CSS: width: calc((100% - 6px - (count - 1) * 2px) / count)
    const indicator = (stripWidth - 2 * PADDING - (PERIOD_TAB_COUNT - 1) * GAP) / PERIOD_TAB_COUNT;
    assert.equal(indicator, column, `indicator width must equal a column at ${stripWidth}px`);
    for (let index = 0; index < PERIOD_TAB_COUNT; index += 1) {
      const columnLeft = PADDING + index * (column + GAP);
      // Mirrors the CSS: left: 3px + translate3d(index * (100% + 2px))
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
