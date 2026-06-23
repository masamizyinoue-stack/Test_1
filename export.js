// export.js — ファイル出力・エクスポート機能
// DXF Viewer V0_92
// 依存グローバル: cv, ov, doc, hiddenLayers, tx, ty, scale, bwMode, pdfImage, currentFileName (viewer.js)
//               draw, drawAnnotation, scheduleDraw, scheduleOverlay (viewer.js)
//               strokes, dims (var, HTML inline script)
//               hiddenLayers (layer.js)
//               rgbToAci, dxfEncText (utils.js)
//               showGuide, hideGuide (ui.js)
//               drawOverlay (HTML inline script)
// V0_92: PDF黒画面バグ修正
//   - LONG_PX: 8000→6000（iPad安全canvas範囲: ~25.5MP、513DPI for A4）
//   - 出力形式: PNG→JPEG 0.98（大容量PNG→jsPDF失敗の回避、高品質維持）
// V0_91: PDF最高解像度対応（LONG_PX=8000、PNG、try-finally）
// V0_90: スクショ修正（html2canvas+実canvas合成ハイブリッド、bwMode対応）

// =========================================================
// DXF書き出し（元データ + 書き込みストローク）
// =========================================================
function exportSketchDxf(){
  if(!doc&&(!strokes||strokes.length===0)){showGuide('データがありません',1500);return;}

  const layerSet=new Set(['SKETCH']);
  if(doc){
    for(const e of [...(doc.sen||[]),...(doc.enko||[]),...(doc.ten||[]),...(doc.moji||[])]){
      if(e.layer) layerSet.add(e.layer);
    }
  }

  const L=[];

  L.push('0','SECTION','2','HEADER',
    '9','$ACADVER','1','AC1009',
    '9','$INSUNITS','70','4',
    '0','ENDSEC');

  L.push('0','SECTION','2','TABLES',
    '0','TABLE','2','LAYER',
    '70',String(layerSet.size));
  for(const lname of layerSet){
    L.push('0','LAYER','2',lname,'70','0','62','7','6','CONTINUOUS');
  }
  L.push('0','ENDTAB','0','ENDSEC');

  L.push('0','SECTION','2','ENTITIES');

  if(doc){
    for(const e of (doc.sen||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','LINE',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x1),'20',String(e.y1),'30','0',
        '11',String(e.x2),'21',String(e.y2),'31','0');
    }
    for(const e of (doc.enko||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      const isCircle=(Math.abs(e.a2-e.a1-360)<0.01)||(e.a1===0&&e.a2===360);
      if(isCircle){
        L.push('0','CIRCLE',
          '8',e.layer||'0','62',String(ci),
          '10',String(e.cx),'20',String(e.cy),'30','0',
          '40',String(e.r||e.rx));
      } else {
        L.push('0','ARC',
          '8',e.layer||'0','62',String(ci),
          '10',String(e.cx),'20',String(e.cy),'30','0',
          '40',String(e.r||e.rx),
          '50',String(e.a1),'51',String(e.a2));
      }
    }
    for(const e of (doc.ten||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','POINT',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x),'20',String(e.y),'30','0');
    }
    for(const e of (doc.moji||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','TEXT',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x),'20',String(e.y),'30','0',
        '40',String(e.h||1),
        '50',String(e.angle||0),
        '1',dxfEncText(e.text||''));
    }
  }

  for(const s of (strokes||[])){
    if(!s.pts||s.pts.length<2) continue;
    const ci=rgbToAci(s.color.r,s.color.g,s.color.b);
    L.push('0','POLYLINE',
      '8','SKETCH','62',String(ci),
      '66','1',
      '10','0','20','0','30','0',
      '70','0');
    for(const p of s.pts){
      L.push('0','VERTEX',
        '8','SKETCH',
        '10',String(p.x),'20',String(p.y),'30','0',
        '70','0');
    }
    L.push('0','SEQEND','8','SKETCH');
  }

  L.push('0','ENDSEC','0','EOF');
  const content=L.join('\n');
  const blob=new Blob([content],{type:'application/octet-stream'});
  const baseName=(currentFileName||'export').replace(/\.[^.]+$/,'');
  const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,16);
  const fileName=`${baseName}_export_${ts}.dxf`;
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=fileName;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showGuide('DXF書き出し完了',2000);
}

// =========================================================
// PDF出力ボタン（最高解像度・JPEG高品質出力）
// =========================================================
document.getElementById('savePDFBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('savePDFBtn');
  btn.disabled = true;
  showGuide('PDFを生成中...');
  try{
    // ── 1. バウンディングボックス計算（V0_103: computeBBox使用で全エンティティ対応）─
    // computeBBoxはdoc全エンティティ(sen/enko/ten/moji/solid)+pdfImage+images を含む
    const _bb=computeBBox();
    let mnX=isFinite(_bb.minx)?_bb.minx:Infinity;
    let mnY=isFinite(_bb.miny)?_bb.miny:Infinity;
    let mxX=isFinite(_bb.maxx)?_bb.maxx:-Infinity;
    let mxY=isFinite(_bb.maxy)?_bb.maxy:-Infinity;
    function upd(x,y){if(!isFinite(x)||!isFinite(y))return;mnX=Math.min(mnX,x);mxX=Math.max(mxX,x);mnY=Math.min(mnY,y);mxY=Math.max(mxY,y);}
    // ペン・寸法（ユーザー追記）もboundsに含める
    for(const s of strokes)for(const p of s.pts)upd(p.x,p.y);
    for(const d of dims){
      for(const l of(d.lines||[]))upd(l.x1,l.y1),upd(l.x2,l.y2);
      if(d.tx!=null&&d.ty!=null)upd(d.tx,d.ty);
    }
    if(!isFinite(mnX)){showGuide('描画データがありません',2000);return;}

    // ── 2. キャンバスサイズ決定（最高解像度: 684DPI相当 for A4）────
    // V0_91: LONG_PX 5000→8000。Object.defineProperty(dpr=1)使用でcanvas=CW×CH
    // iPadの安全canvas上限~67MPに対し 8000×5657=45.3MP で余裕あり
    const PAD=0.02;  // 余白2%
    const eW=mxX-mnX, eH=mxY-mnY;
    const extMinX=mnX-eW*PAD, extMinY=mnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);

    const LONG_PX=6500;  // V0_92: 8000→6000（513DPI for A4、iPad安全25.5MP以内）/ V0_95: 6000→6500（556DPI）
    const aspect=extW/extH;
    const CW=aspect>=1?LONG_PX:Math.round(LONG_PX*aspect);
    const CH=aspect>=1?Math.round(LONG_PX/aspect):LONG_PX;

    const PDF_LONG_MM=297;
    const pageMM_W=aspect>=1?PDF_LONG_MM:Math.round(PDF_LONG_MM*aspect);
    const pageMM_H=aspect>=1?Math.round(PDF_LONG_MM/aspect):PDF_LONG_MM;

    // ── 3. 状態退避・PDF用設定 ─────────────────────────────
    const sv={tx,ty,scale};
    const cvEl=document.getElementById('cv');
    const ovEl=document.getElementById('ov');
    const sv_cw=cvEl.width,sv_ch=cvEl.height;
    const sv_ow=ovEl.width,sv_oh=ovEl.height;
    const dprSave=window.devicePixelRatio||1;

    const pdfScale=Math.min(CW/extW,CH/extH);
    tx=-extMinX*pdfScale;
    ty=CH+extMinY*pdfScale;
    scale=pdfScale;

    // draw()内部のctx.scale(dpr,dpr)をdpr=1に固定してcanvas=CW×CHで正確に描画させる
    Object.defineProperty(window,'devicePixelRatio',{get:()=>1,configurable:true});
    cvEl.width=CW; cvEl.height=CH;
    ovEl.width=CW; ovEl.height=CH;
    // PDF用線幅スケール: CW/CSS_W（CSS幅比率）
    window._pdfScale=CW*dprSave/sv_ow;

    const acEl=document.createElement('canvas');
    acEl.width=CW; acEl.height=CH;
    const acCtx=acEl.getContext('2d');

    // ── 4. 描画・合成（finally で必ず状態復元）──────────────
    let comp=null;
    try{
      if(typeof draw==='function') draw();
      if(typeof drawAnnotation==='function') drawAnnotation(acCtx);
      if(typeof drawOverlay==='function') drawOverlay();

      comp=document.createElement('canvas');
      comp.width=CW; comp.height=CH;
      const cctx=comp.getContext('2d');
      cctx.fillStyle=bwMode?'#fff':'#1e2430';
      cctx.fillRect(0,0,CW,CH);
      cctx.drawImage(cvEl,0,0);
      cctx.drawImage(acEl,0,0);
      cctx.drawImage(ovEl,0,0);
    }finally{
      // 描画エラー時も必ず状態を復元
      try{Object.defineProperty(window,'devicePixelRatio',{get:()=>dprSave,configurable:true});}catch(e){}
      window._pdfScale=undefined;
      tx=sv.tx; ty=sv.ty; scale=sv.scale;
      cvEl.width=sv_cw; cvEl.height=sv_ch;
      ovEl.width=sv_ow; ovEl.height=sv_oh;
      if(typeof scheduleDraw==='function') scheduleDraw();
      if(typeof scheduleOverlay==='function') scheduleOverlay();
    }
    if(!comp){showGuide('描画に失敗しました',2000);return;}

    // ── 5. jsPDF で PDF 生成（JPEG 0.98: 高品質・大容量PNG回避）──────────
    if(typeof window.jspdf==='undefined'){
      const url=URL.createObjectURL(await new Promise(r=>comp.toBlob(r,'image/png')));
      const a=document.createElement('a');
      a.href=url; a.download=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+`_${new Date().toISOString().slice(0,10)}.png`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      showGuide('画像として保存しました',2000); return;
    }
    const {jsPDF}=window.jspdf;
    const orient=pageMM_W>=pageMM_H?'l':'p';
    const pdf=new jsPDF({orientation:orient,unit:'mm',format:[pageMM_W,pageMM_H],compress:true});
    // V0_92: JPEG 0.98（PNG at 45MP → jsPDF/iOS failure の回避、高品質維持）
    const imgData=comp.toDataURL('image/jpeg',0.97);
    pdf.addImage(imgData,'JPEG',0,0,pageMM_W,pageMM_H);
    const ts=new Date().toISOString().slice(0,10);
    const fname=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+'.pdf'; // V0_96: DXFファイル名をそのまま使用
    pdf.save(fname);
    showGuide('PDFを保存しました',2000);
    if(typeof window._afterPDFExport==='function'){var _cb=window._afterPDFExport;window._afterPDFExport=null;setTimeout(_cb,600);} // V0_105

  }catch(err){
    console.error('PDF export error:',err);
    showGuide('PDF出力に失敗しました: '+err.message,3000);
  }finally{
    document.getElementById('savePDFBtn').disabled=false;
  }
});

// =========================================================
// スクリーンショット保存ボタン（V0_90: html2canvas+実canvas合成）
// =========================================================
document.getElementById('screenshotBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('screenshotBtn');
  btn.disabled = true;
  showGuide('スクリーンショットを保存中...');
  try{
    // html2canvasはcanvas内容を描画できないため、実canvasを直接合成する
    // html2canvasはUIレイヤー（ヘッダー等）取得のみに使い、ステージ領域を実canvasで上書き
    const dpr = window.devicePixelRatio || 1;
    const cvEl = document.getElementById('cv');
    const acEl = document.getElementById('ac');
    const ovEl = document.getElementById('ov');
    const stageEl = document.getElementById('stage');

    // Step1: 実canvasを合成（DXF + アノテーション + オーバーレイ）
    const W = cvEl.width, H = cvEl.height;
    const stageCanvas = document.createElement('canvas');
    stageCanvas.width = W; stageCanvas.height = H;
    const sctx = stageCanvas.getContext('2d');
    sctx.fillStyle = bwMode ? '#ffffff' : '#1e2430';
    sctx.fillRect(0, 0, W, H);
    sctx.drawImage(cvEl, 0, 0);
    sctx.drawImage(acEl, 0, 0);
    sctx.drawImage(ovEl, 0, 0);

    let imageBlob = null;

    // Step2: html2canvasでUIレイヤー（ヘッダー等）取得 → ステージ領域を実canvas内容で上書き
    if(typeof html2canvas !== 'undefined'){
      try{
        const uiCanvas = await html2canvas(document.body, {
          scale: dpr,
          backgroundColor: bwMode ? '#ffffff' : '#0b0f16',
          logging: false,
          imageTimeout: 8000
        });
        const stageRect = stageEl.getBoundingClientRect();
        const sx = Math.round(stageRect.left * dpr);
        const sy = Math.round(stageRect.top * dpr);
        const bctx = uiCanvas.getContext('2d');
        bctx.fillStyle = bwMode ? '#ffffff' : '#1e2430';
        bctx.fillRect(sx, sy, W, H);
        bctx.drawImage(stageCanvas, sx, sy);
        imageBlob = await new Promise(res => uiCanvas.toBlob(res, 'image/png'));
      }catch(e){
        console.warn('html2canvas failed, fallback to canvas composite:', e);
      }
    }

    // Step3: フォールバック（html2canvas失敗またはなし）
    if(!imageBlob){
      imageBlob = await new Promise(res => stageCanvas.toBlob(res, 'image/png'));
    }

    const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const baseName = (currentFileName||'screenshot').replace(/\.[^.]+$/,'');
    const fileName = `${baseName}_${ts}.png`;
    const file = new File([imageBlob], fileName, {type:'image/png'});

    let shared = false;
    if(navigator.share && typeof navigator.canShare === 'function' && navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file], title:fileName});
        shared = true;
      }catch(shareErr){
        if(shareErr.name === 'AbortError'){ hideGuide(); return; }
      }
    }
    if(!shared){
      const url = URL.createObjectURL(imageBlob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }
    showGuide('保存しました', 2000);
  }catch(err){
    if(err.name !== 'AbortError'){
      console.error('Screenshot error:', err);
      hideGuide();
    } else {
      hideGuide();
    }
  }finally{
    btn.disabled = false;
  }
});

// =========================================================
// DXF書き出しボタン
// =========================================================
document.getElementById('exportDxfBtn').addEventLis