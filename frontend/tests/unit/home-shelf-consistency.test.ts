import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  homeMediaCardSx,
  homeMediaTitleSx,
  homeMediaPlaySx,
  homeMediaShelfSx,
} from '../../src/components/Home/homeMediaStyles'

const readComponent = (name: string) =>
  readFileSync(path.resolve(process.cwd(), 'src/components/Home', name), 'utf8')

test('favorites, frequent tracks and recent tracks share one vertical artwork card layout', () => {
  const source = readComponent('PersonalizedSection.tsx')
  assert.match(source, /renderRow\('最近播放', data.recentlyPlayed\)/)
  assert.match(source, /renderRow\('常聽的歌', data.mostPlayed, true\)/)
  assert.match(source, /renderRow\('我的收藏', data.favorites, true\)/)
  assert.doesNotMatch(source, /compactRows|compact \?/)
  assert.match(source, /<Box sx=\{homeMediaShelfSx\}>/)
  assert.match(source, /flexDirection: 'column'/)
  assert.match(source, /aspectRatio: '16 \/ 10'/)
  assert.match(source, /width: isDesktop \? '100%' : \{ xs: 192, sm: 216 \}/)
  assert.match(source, /position: 'absolute',\s*right: 8,\s*bottom: 8,\s*\.\.\.homeMediaPlaySx/)
})

test('recommendations and personalized shelves retain shared tokens and accessible hit targets', () => {
  for (const name of ['PersonalizedSection.tsx', 'ChannelSection.tsx']) {
    const source = readComponent(name)
    assert.match(source, /homeMediaCardSx/)
    assert.match(source, /homeMediaShelfSx/)
    assert.match(source, /sx=\{homeMediaTitleSx\}/)
    assert.match(source, /homeMediaPlaySx/)
    assert.match(source, /aspectRatio: '16 \/ 10'/)
    assert.match(source, /aria-label=\{`播放 /)
    assert.match(source, /'&.Mui-focusVisible': \{ outlineOffset: -3 \}/)
  }
  assert.equal(homeMediaCardSx.borderRadius, 2)
  assert.equal(homeMediaPlaySx.width, 44)
  assert.equal(homeMediaPlaySx.height, 44)
  assert.equal(homeMediaTitleSx.WebkitLineClamp, 2)
  assert.equal(homeMediaTitleSx.overflowWrap, 'anywhere')
  assert.deepEqual(homeMediaShelfSx.display, { xs: 'flex', md: 'grid' })
  assert.equal(homeMediaShelfSx.gap, 2)
})

test('collection show-more limits, empty sections and whole-card playback remain intact', () => {
  const source = readComponent('PersonalizedSection.tsx')
  assert.match(source, /collapsedLimit = expandableCollection \? 4 : isDesktop \? 6 : 10/)
  assert.match(source, /canExpand = expandableCollection \|\| isDesktop/)
  assert.match(source, /limit = canExpand && expanded\[title\] \? 20 : collapsedLimit/)
  assert.match(source, /aria-expanded=\{Boolean\(expanded\[title\]\)\}/)
  assert.match(source, /if \(!items \|\| items.length === 0\) return null/)
  assert.match(source, /onClick=\{\(\) => handlePlay\(item\)\}/)
  assert.match(source, /id: item.videoId,\s*videoId: item.videoId,/)
  assert.match(source, /onPlay\(track\)/)
})
