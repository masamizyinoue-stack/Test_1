// storage.js — ローカルストレージ保存・復元
// DXF Viewer V0_65
// 依存グローバル: strokes, dims, savedViews (var), tx, ty, scale, bwMode, currentFileName (viewer.js)
//               hiddenLayers (layer.js)
//               currentTool, currentColor, currentLW (var, HTML inline script)
// 依存関数: arrayBufferToB64 (utils.js)
//           loadPDF, parseDXF, detectScale, updateFileNameDisplay, scheduleDraw, scheduleOverlay (viewer.js)
//           buildLayerModal (layer.js)
//           updateViewmemoState (ui.js)
//           updateUndoRedo (HTML inline script)

const SAVE_KEY='dxfview_v1';
const FILE_KEY='dxfview_v1_file';
let saveTimer=null;

// =========================================================
// 自動保存スケジュール
// =========================================================
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(doSave,800);}

// =========================================================
// localStorage へ保存
// =========================================================
function doSave(){
  try{
    const sd=parseFloat(document.getElementById('scaleDenom').value)||1;
    localStorage.setItem(SAVE_KEY,JSON.stringify({
      strokes,dims,savedViews,tx,ty,scale,
      bwMode,scaleDenom:sd,hiddenLayers:[...hiddenLayers],
      currentTool,currentColor,currentLW,currentFileName
    }));
  }catch(e){}
}

// =========================================================
// ファイルを localStorage へ保存（1.5MB 超は保存しない）
// =========================================================
function saveFile(buf,name){
  if(!buf||buf.byteLength>1.5*1024*1024){localStorage.removeItem(FILE_KEY);return;}
  try{localStorage.setItem(FILE_KEY,JSON.stringify({name,b64:arrayBufferToB64(buf)}));}
  catch(e){localStorage.removeItem(FILE_KEY);}
}

// =========================================================
// ページ読み込み時の復元
// =========================================================
async function tryRestore(){
  try{
    const fr=localStorage.getItem(FILE_KEY);
    if(fr){
      const{name,b64}=JSON.parse(fr);
      const bin=atob(b64);const buf=new ArrayBuffer(bin.length);const arr=new Uint8Array(buf);
      for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      currentFileName=name;
      if(name.toLowerCase().endsWith('.pdf')){
        await loadPDF(buf);
      } else {
        doc=parseDXF(buf);buildLayerModal();detectScale();
      }
      const nd=document.getElementById('noDrawingMsg');if(nd)nd.style.display='none';
      updateFileNameDisplay();
    }
    const raw=localStorage.getItem(SAVE_KEY);if(!raw)return;
    const d=JSON.parse(raw);
    strokes=d.strokes||[];dims=d.dims||[];
    savedViews=d.savedViews||[null,null,null];
    tx=d.tx||0;ty=d.ty||0;scale=d.scale||1;
    bwMode=!!d.bwMode;
    if(d.hiddenLayers)hiddenLayers=new Set(d.hiddenLayers);
    currentTool=d.currentTool||'sketch';
    if(currentTool==='dx'||currentTool==='dy')currentTool='dxdy';
    if(d.currentColor)currentColor=d.currentColor;
    if(d.currentLW)currentLW=d.currentLW;
    if(d.scaleDenom)document.getElementById('scaleDenom').value=d.scaleDenom;
    if(bwMode){
      document.getElementById('bwWhite').classList.add('active');
      document.getElementById('bwBlack').classList.remove('active');
    } else {
      document.getElementById('bwBlack').classList.add('active');
      document.getElementById('bwWhite').classList.remove('active');
    }
    document.querySelectorAll('.tool-btn').forEach(b=>{
      b.classList.toggle('active',b.dataset.tool===currentTool);
    });
    const dot=document.getElementById('colorDot');
    if(dot&&currentColor)dot.style.background=`rgb(${currentColor.r},${currentColor.g},${currentColor.b})`;
    [0,1,2].forEach(i=>updateViewmemoState(i));
    scheduleDraw();scheduleOverlay();updateUndoRedo();
  }catch(e){console.warn('restore:',e);}
}
