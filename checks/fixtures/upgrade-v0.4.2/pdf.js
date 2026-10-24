// html2pdf integration adapted from oxsum324/level-survey-recorder, app.js,
// commit 78f2ae02646510290854e89ff1ba901776bce9f5. 複製後獨立演進。
let loading;
function library(){return loading||=new Promise((resolve,reject)=>{if(window.html2pdf)return resolve();const script=document.createElement('script');script.src='./vendor/html2pdf.bundle.min.js';script.onload=resolve;script.onerror=()=>{loading=null;reject(Error('PDF 元件尚未就緒，請先連線開啟工具，或使用系統列印。'));};document.head.append(script);});}
export async function imagePdf(root,onProgress=()=>{}){
  await library();await document.fonts.ready;let pdf;const sheets=[...root.querySelectorAll('.sheet')];
  const container=document.createElement('div');container.className='pdf-export';container.style.cssText='position:absolute;left:-10000px;top:0;width:210mm;background:white;--report-scale:1';document.body.append(container);
  try{for(const [index,sheet] of sheets.entries()){
    onProgress(index+1,sheets.length);const clone=sheet.cloneNode(true);clone.style.zoom='1';clone.style.margin='0';clone.style.boxShadow='none';container.replaceChildren(clone);await Promise.all([...clone.querySelectorAll('img')].map(img=>img.decode()));
    const worker=window.html2pdf().set({margin:0,image:{type:'jpeg',quality:.95},html2canvas:{scale:2,useCORS:false,logging:false,scrollY:0,backgroundColor:'#fff'},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}}).from(clone).toCanvas();const canvas=await worker.get('canvas');if(!pdf){pdf=await worker.toPdf().get('pdf');const expected=Math.max(1,Math.ceil(canvas.height/(canvas.width*297/210)-.002));while(pdf.internal.getNumberOfPages()>expected)pdf.deletePage(pdf.internal.getNumberOfPages());canvas.width=1;canvas.height=1;continue;}
    // Render one sheet at a time to avoid browser canvas-height limits on long cases.
    const height=canvas.width*297/210,total=Math.ceil(canvas.height/height-.002);
    for(let part=0;part<total;part++){pdf.addPage();const crop=document.createElement('canvas');crop.width=canvas.width;crop.height=Math.ceil(height);const ctx=crop.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(canvas,0,-part*height);pdf.addImage(crop.toDataURL('image/jpeg',.95),'JPEG',0,0,210,297);crop.width=1;crop.height=1;}
    canvas.width=1;canvas.height=1;
  }return pdf.output('blob');}finally{container.remove();}
}
