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
    // ── 1. バウンディングボックス計算（V0_111: 全エンティティ対象・hiddenLayer無視）─
    // PDF出力はDXF全体を対象とするため、非表示レイヤも含めてBoundsを計算する
    function _expAll(x,y){if(!isFinite(x)||!isFinite(y))return;if(x<_allMnX)_allMnX=x;if(y<_allMnY)_allMnY=y;if(x>_allMxX)_allMxX=x;if(y>_allMxY)_allMxY=y;}
    var _allMnX=Infinity,_allMnY=Infinity,_allMxX=-Infinity,_allMxY=-Infinity;
    if(doc){
      for(const e of doc.sen){_expAll(e.x1,e.y1);_expAll(e.x2,e.y2);}
      for(const e of doc.enko){const r=e.rx||e.r||0;_expAll(e.cx-r,e.cy-r);_expAll(e.cx+r,e.cy+r);}
      for(const e of doc.ten){_expAll(e.x,e.y);}
      for(const e of doc.moji){_expAll(e.x,e.y);}
      for(const e of doc.solid){for(const p of e.pts)_expAll(p.x,p.y);}
    }
    if(pdfImage){_expAll(pdfImage.wx,pdfImage.wy);_expAll(pdfImage.wx+pdfImage.ww,pdfImage.wy-pdfImage.wh);}
    for(const img of images){_expAll(img.wx,img.wy);_expAll(img.wx+img.ww,img.wy-img.wh);}
    // データなし時はcomputeBBox()にフォールバック
    const _bbFull=isFinite(_allMnX)?{minx:_allMnX,miny:_allMnY,maxx:_allMxX,maxy:_allMxY}:computeBBox();
    let mnX=isFinite(_bbFull.minx)?_bbFull.minx:Infinity;
    let mnY=isFinite(_bbFull.miny)?_bbFull.miny:Infinity;
    let mxX=isFinite(_bbFull.maxx)?_bbFull.maxx:-Infinity;
    let mxY=isFinite(_bbFull.maxy)?_bbFull.maxy:-Infinity;
    function upd(x,y){if(!isFinite(x)||!isFinite(y))return;mnX=Math.min(mnX,x);mxX=Math.max(mxX,x);mnY=Math.min(mnY,y);mxY=Math.max(mxY,y);}
    // ペン・寸法（ユーザー追記）もboundsに含める
    for(const s of strokes)for(const p of s.pts)upd(p.x,p.y);
    for(const d of dims){
      for(const l of(d.lines||[]))upd(l.x1,l.y1),upd(l.x2,l.y2);
      if(d.tx!=null&&d.ty!=null)upd(d.tx,d.ty);
    }
    if(!isFinite(mnX)){showGuide('描画データがありません',2000);return;}

    // ── 2. キャンバスサイズ決定 ─────────────────────────────
    const PAD=0.02;  // 余白2%
    const eW=mxX-mnX, eH=mxY-mnY;
    const extMinX=mnX-eW*PAD, extMinY=mnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);

    // ★代替案反映: 解像度を上げてボケを抑制（6500 → 8000）
    const LONG_PX=8000;  
    const aspect=extW/extH;
    let CW=aspect>=1?LONG_PX:Math.round(LONG_PX*aspect);  // V0_117: let（サイズ制限時に縮小）
    let CH=aspect>=1?Math.round(LONG_PX/aspect):LONG_PX;  // V0_117: let

    const PDF_LONG_MM=297;
    const pageMM_W=aspect>=1?PDF_LONG_MM:Math.round(PDF_LONG_MM*aspect);
    const pageMM_H=aspect>=1?Math.round(PDF_LONG_MM/aspect):PDF_LONG_MM;

    // ── 3. 状態退避・PDF用設定 ─────────────────────────────
    const sv={tx,ty,scale};
    const cvEl=document.getElementById('cv');
    const ovEl=document.getElementById('ov');
    const sv_ow=ovEl.width;  // V0_117: _pdfScale計算用のみ（cvEl/ovElはリサイズしない）
    const dprSave=window.devicePixelRatio||1;

    let pdfScale=Math.min(CW/extW,CH/extH);
    tx=-extMinX*pdfScale; ty=CH+extMinY*pdfScale; scale=pdfScale;

    // V0_117: ④ Canvasサイズ制限の検知 / ⑤ 制限超過時はLONG_PX縮小で対応
    {
      const _tc=document.createElement('canvas');
      _tc.width=CW; _tc.height=CH;
      const _tc2=_tc.getContext('2d');
      _tc2.fillStyle='#ff0000'; _tc2.fillRect(CW-1,CH-1,1,1);
      if(_tc2.getImageData(CW-1,CH-1,1,1).data[3]===0){
        // Canvas制限超過。LONG_PXを0.75倍ずつ縮小して再探索
        let _lpx=Math.floor(LONG_PX*0.75);
        let _found=false;
        while(_lpx>=2000){
          const _tCW=aspect>=1?_lpx:Math.round(_lpx*aspect);
          const _tCH=aspect>=1?Math.round(_lpx/aspect):_lpx;
          const _tc3=document.createElement('canvas'); _tc3.width=_tCW; _tc3.height=_tCH;
          const _tc4=_tc3.getContext('2d');
          _tc4.fillStyle='#ff0000'; _tc4.fillRect(_tCW-1,_tCH-1,1,1);
          if(_tc4.getImageData(_tCW-1,_tCH-1,1,1).data[3]>0){CW=_tCW;CH=_tCH;_found=true;break;}
          _lpx=Math.floor(_lpx*0.75);
        }
        if(!_found){showGuide('Canvasサイズが不足しています',3000);return;}
        pdfScale=Math.min(CW/extW,CH/extH);
        tx=-extMinX*pdfScale; ty=CH+extMinY*pdfScale; scale=pdfScale;
        console.warn('[PDF] Canvasサイズ制限検知 → '+CW+'×'+CH+'px に縮小');
      }
    }

    // draw()内部のctx.scale(dpr,dpr)をdpr=1に固定してcanvas=CW×CHで正確に描画させる
    Object.defineProperty(window,'devicePixelRatio',{get:()=>1,configurable:true});
    // PDF用線幅スケール: CW/CSS_W（CSS幅比率）
    window._pdfScale=CW*dprSave/sv_ow;

    // V0_117: ② PDF専用Canvas作成（画面表示用Canvasを使用しない）
    const pdfCv=document.createElement('canvas'); pdfCv.width=CW; pdfCv.height=CH;
    const pdfCtx=pdfCv.getContext('2d');
    const pdfOv=document.createElement('canvas'); pdfOv.width=CW; pdfOv.height=CH;
    const pdfOctx=pdfOv.getContext('2d');  // desynchronized不使用（確実な描画完了のため）
    const pdfAc=document.createElement('canvas'); pdfAc.width=CW; pdfAc.height=CH;
    const pdfAcCtx=pdfAc.getContext('2d');
    // 描画グローバル（cv/ctx/ov/octx）をPDF専用Canvasに一時置換
    const _svCv=window.cv,_svCtx=window.ctx,_svOv=window.ov,_svOctx=window.octx;
    window.cv=pdfCv; window.ctx=pdfCtx; window.ov=pdfOv; window.octx=pdfOctx;

    // ── 4. 描画・合成（finally で必ず状態復元）──────────────
    let pdfComp=null;
    try{
      if(typeof draw==='function') draw();
      if(typeof drawAnnotation==='function') drawAnnotation(pdfAcCtx);
      if(typeof drawOverlay==='function') drawOverlay();
      // V0_117: ③ 描画完了を待つ（desynchronized canvas等の非同期描画に対応）
      await new Promise(r=>requestAnimationFrame(r));

      // V0_117: PDF専用Canvasに合成（画面表示Canvasは不使用）
      pdfComp=document.createElement('canvas'); pdfComp.width=CW; pdfComp.height=CH;
      const pctx=pdfComp.getContext('2d');
      pctx.fillStyle=bwMode?'#fff':'#1e2430';
      pctx.fillRect(0,0,CW,CH);
      pctx.drawImage(pdfCv,0,0);
      pctx.drawImage(pdfAc,0,0);
      pctx.drawImage(pdfOv,0,0);
    }finally{
      // 描画エラー時も必ず状態を復元
      try{Object.defineProperty(window,'devicePixelRatio',{get:()=>dprSave,configurable:true});}catch(e){}
      window._pdfScale=undefined;
      window.cv=_svCv; window.ctx=_svCtx; window.ov=_svOv; window.octx=_svOctx;
      tx=sv.tx; ty=sv.ty; scale=sv.scale;
      if(typeof scheduleDraw==='function') scheduleDraw();
      if(typeof scheduleOverlay==='function') scheduleOverlay();
    }
    if(!pdfComp){showGuide('描画に失敗しました',2000);return;}

    // ── 5. jsPDF で PDF 生成 ─────────────────────────────
    if(typeof window.jspdf==='undefined'){
      const url=URL.createObjectURL(await new Promise(r=>pdfComp.toBlob(r,'image/png')));
      const a=document.createElement('a');
      a.href=url; a.download=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+`_${new Date().toISOString().slice(0,10)}.png`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      showGuide('画像として保存しました',2000); return;
    }
    const {jsPDF}=window.jspdf;
    const orient=pageMM_W>=pageMM_H?'l':'p';
    const pdf=new jsPDF({orientation:orient,unit:'mm',format:[pageMM_W,pageMM_H],compress:true});
    
    // ★代替案反映: JPEG品質を下げることで、高解像度化による容量アップを相殺（0.97 → 0.88）
    const imgData=pdfComp.toDataURL('image/jpeg',0.88);
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
        // V0_118: stageRectをhtml2canvas実行前に取得し、scrollオフセットも加算
        // （html2canvas完了後に取得するとレイアウト変化で座標がずれる場合があるため）
        const stageRect = stageEl.getBoundingClientRect();
        const sx = Math.round((stageRect.left + window.scrollX) * dpr);
        const sy = Math.round((stageRect.top  + window.scrollY) * dpr);
        const uiCanvas = await html2canvas(document.body, {
          scale: dpr,
          backgroundColor: bwMode ? '#ffffff' : '#0b0f16',
          logging: false,
          imageTimeout: 8000
        });
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
document.getElementById('exportDxfBtn').addEventListener('click',exportSketchDxf);

// =========================================================
// V0_122: .dxfview書出し（dims + strokes のみ）
// =========================================================
function exportDxfview(){
  try{
    if((!dims||dims.length===0)&&(!strokes||strokes.length===0)){
      showGuide('保存する寸法・手書きがありません',2000);return;
    }
    const fk=(_fileKey?_fileKey(currentFileName,currentFileSize):null)||currentFileName||'';
    const payload={
      format:'dxfview',
      version:1,
      appVersion:APP_VERSION,
      fileName:currentFileName||'',
      fileSize:currentFileSize||0,
      fileKey:fk,
      exportedAt:new Date().toISOString(),
      dims:dims,
      strokes:strokes
    };
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const base=(currentFileName||'export').replace(/\.[^.]+$/,'');
    const date=new Date().toISOString().slice(0,10);
    const fname=base+'_'+date+'.dxfview';
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=fname;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    showGuide('.dxfviewを保存しました',2000);
  }catch(e){
    console.warn('[dxfview export] failed',e);
    showGuide('.dxfview保存に失敗しました',2000);
  }
}
document.getElementById('exportDxfviewBtn').addEventListener('click',exportDxfview);