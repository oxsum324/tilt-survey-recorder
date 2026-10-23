from pathlib import Path
import sys,json,re,hashlib
import fitz
from pdf_assertions import assert_cell_heading

pdf=Path(sys.argv[1]); expected=json.loads((Path(__file__).parent/'expected.json').read_text(encoding='utf-8'))
doc=fitz.open(pdf); assert len(doc)==3, f'Expected 3 A4 pages, got {len(doc)}'
norm=lambda text: re.sub(r'\s+','',text)
texts=[p.get_text() for p in doc]
output={'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pageCount':len(doc),'cells':[],'rawPages':[],'renderedPages':[]}
for p in doc:
 assert abs(p.rect.width-595)<2 and abs(p.rect.height-842)<2, 'Unexpected page size'
 assert len(p.get_text().strip())>100, 'Empty PDF page'
 (pdf.parent/f'pdf-page-{p.number+1}.txt').write_text(p.get_text(),encoding='utf-8')
 # Preserve a render of every page for visual review, not just text extraction.
 path=pdf.parent/f'pdf-page-{p.number+1}.png';p.get_pixmap(matrix=fitz.Matrix(1.35,1.35)).save(path)
 output['renderedPages'].append(path.name)
assert '傾斜測量成果表' in texts[0]
for i,e in enumerate(expected):
 p=doc[0];x0=0 if i%2==0 else p.rect.width/2;x1=p.rect.width/2 if i%2==0 else p.rect.width
 y0=0 if i<2 else p.rect.height*.53;y1=p.rect.height*.53 if i<2 else p.rect.height
 cell_text=p.get_text(clip=fitz.Rect(x0,y0,x1,y1))
 assert_cell_heading(cell_text,e)
 text=norm(cell_text)
 tokens=[e['label'],e['tp'],e['tb'],'△X＝'+e['dx']+'cm','H＝'+e['height']+'cm','△X／H＝'+e['ratio']+'（'+e['direction']+'）']
 for token in tokens: assert norm(token) in text, f"PDF cell {e['label']} missing {token}"
 output['cells'].append({'label':e['label'],'matchedTokens':tokens})
for i in range(2):
 text=norm(texts[i+1]);assert '傾斜測量原始讀數表' in text
 assert f'測點組{i+1}｜前側立面（示例）｜TP{i+1}、TB{i+1}' in text
 tokens=[]
 for e in expected[i*2:i*2+2]:
  for token in [e['label']+'模式A第1回：ΔX'+e['dx']+'cm', 'H'+e['height']+'cm', f"d＝{e['dxMm']}mm，H＝{e['heightMm']}mm",f"{e['heightMm']}÷{e['dxMm']}→{e['ratio']}；{e['direction']}"]:
   assert norm(token) in text, f'PDF raw page {i+2} missing {token}';tokens.append(token)
 output['rawPages'].append({'page':i+2,'matchedTokens':tokens})
shorts=[re.findall(r'資料指紋\s*SHA-256[：:]\s*([a-f0-9]{16})',text) for text in texts]
full=re.findall(r'完整\s*SHA-256[：:]\s*([a-f0-9]{64})',texts[-1]);assert len(full)==1
assert all(s==[full[0][:16]] for s in shorts), 'Page fingerprints differ'
fingerprint=json.loads((pdf.parent/'screen-values.json').read_text(encoding='utf-8'))['fingerprint']
assert full[0]==fingerprint,'PDF and screen fingerprints differ'
output['fingerprint']=full[0];output['status']='pass'
(pdf.parent/'pdf-content-check.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'pass','pageCount':len(doc),'matchedCells':4,'matchedRawPages':2,'fingerprint':full[0]},ensure_ascii=True))
