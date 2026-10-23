from pathlib import Path
import json,hashlib,fitz,sys,os
from pdf_assertions import assert_cell_heading

root=Path(__file__).parent
source=Path(sys.argv[1])
expected=json.loads((root/'expected.json').read_text(encoding='utf-8'))
doc=fitz.open(source);p=doc[0];cases=[]
for i,e in enumerate(expected):
 rect=fitz.Rect(0 if i%2==0 else p.rect.width/2,0 if i<2 else p.rect.height*.53,p.rect.width/2 if i%2==0 else p.rect.width,p.rect.height*.53 if i<2 else p.rect.height)
 text=p.get_text(clip=rect);assert_cell_heading(text,e)
 mutations={'prime-or-plain':text.replace('\n'+e['label']+'\n','\n'+(e['label'].rstrip('′') if '′' in e['label'] else e['label']+'′')+'\n',1),'label-prefix':text.replace('\n'+e['label']+'\n','\n'+e['label']+'0\n',1),'tp-prefix':text.replace(e['tp']+'、',e['tp']+'0、',1),'tb-prefix':text.replace(e['tb']+'\n',e['tb']+'0\n',1)}
 for mutation,value in mutations.items():
  assert value!=text,(e['label'],mutation)
  try:assert_cell_heading(value,e)
  except AssertionError:cases.append({'label':e['label'],'mutation':mutation,'rejected':True})
  else:raise AssertionError('Mutated PDF heading incorrectly accepted')
doc.close();assert len(cases)==16
(Path(os.environ['TILT_DESKTOP_RUN_DIR'])/'pdf-label-selftest.json').write_text(json.dumps({'sourcePdfSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'positiveCells':4,'negativeControls':cases},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'positiveCells':4,'rejectedMutations':16,'status':'pass'}))
