import { describe, it, expect } from 'vitest'
import { htmlToText, readTextDocument } from '../text'

describe('htmlToText', () => {
  it('keeps the words, drops scripts, styles and tags, and keeps line breaks between blocks', () => {
    const html =
      '<html><head><style>p{}</style><script>x()</script></head><body><h1>Faktura</h1><p>Belopp: <b>1 249</b> kr &amp; moms</p><table><tr><td>A</td><td>B</td></tr></table></body></html>'
    expect(htmlToText(html)).toBe('Faktura\nBelopp: 1 249 kr & moms\nA B')
  })

  it('reads plain text as one page and refuses empty bodies', () => {
    expect(readTextDocument(Buffer.from('  '), 'text/plain')).toEqual([])
    expect(readTextDocument(Buffer.from('Hej'), 'text/plain')[0]).toMatchObject({ pageNo: 1, reader: 'text', text: 'Hej' })
  })
})
