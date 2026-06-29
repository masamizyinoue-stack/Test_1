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

    // ── 2. キャンバスサイズ決定（最高解像度: 684DPI相当 for A4）────
    // V0_91: LONG_PX 5000→8000。Object.defineProperty(dpr=1)使用でcanvas=CW×CH
    // iPadの安全canvas上限~67MPに対し 8000×5657=45.3MP で余裕あり
    const PAD=0.02;  // 余白2%
    const eW=mxX-mnX, eH=mxY-mnY;
    const extMinX=mnX-eW*PAD, extMinY=mnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);

    const LONG_PX=Math.round(6500*_pdfResMulti);  // V0_92: 8000→6000（513DPI for A4、iPad安全25.5MP以内）/ V0_95: 6000→6500（556DPI）
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
        console.warn('[PDF] V0_117: Canvasサイズ制限検知 → '+CW+'×'+CH+'px に縮小');
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

    // ── 5. jsPDF で PDF 生成（JPEG 0.98: 高品質・大容量PNG回避）──────────
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
    // V0_92: JPEG 0.98（PNG at 45MP → jsPDF/iOS failure の回避、高品質維持）
    const imgData=pdfComp.toDataURL('image/jpeg',0.97);
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
// V0_127: .dxfview自動保存対応。IDB(自動保存)→メモリの頪で読み込み、ダウンロード
async function exportDxfview(){
  try{
    const fk=(_fileKey?_fileKey(currentFileName,currentFileSize):null)||currentFileName||'';
    // IDBから自動保存データを読み込む
    let payload=await new Promise(function(resolve){
      try{
        var r=indexedDB.open('dxfViewerDxfviewDB',1);
        r.onupgradeneeded=function(e){e.target.result.createObjectStore('dv',{keyPath:'fk'});};
        r.onsuccess=function(e){
          try{
            var tx=e.target.result.transaction('dv','readonly');
            var gr=tx.objectStore('dv').get(fk);
            gr.onsuccess=function(){resolve(gr.result||null);};
            gr.onerror=function(){resolve(null);};
          }catch(er){resolve(null);}
        };
        r.onerror=function(){resolve(null);};
      }catch(e){resolve(null);}
    });
    // IDBになければメモリから取得
    if(!payload){
      if((!dims||dims.length===0)&&(!strokes||strokes.length===0)){
        showGuide('保存するデータがありません',2000);return;
      }
      payload={format:'dxfview',version:1,
        fileName:currentFileName||'',fileSize:currentFileSize||0,
        fileKey:fk,dims:dims,strokes:strokes};
    }
    payload.appVersion=APP_VERSION;
    payload.exportedAt=new Date().toISOString();
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
// V0_136: exportDxfviewBtnは削除（書込バックアップ/書込復元に置き換え）

// =========================================================
// V0_136: 書込バックアップ（ヘッダーボタン）
// strokes / dims / savedViews / hiddenLayers を .dxfview に保存
// =========================================================
function exportDxfviewManual(){
  try{
    if((!dims||dims.length===0)&&(!strokes||strokes.length===0)&&
       (!savedViews||savedViews.every(function(v){return!v;}))&&
       (!hiddenLayers||hiddenLayers.size===0)){
      showGuide('保存するデータがありません',2000);return;
    }
    const fk=(typeof _fileKey==='function'?_fileKey(currentFileName,currentFileSize):null)||currentFileName||'';
    const payload={
      version:1,
      format:'dxfview-backup',
      createdAt:new Date().toISOString(),
      appVersion:(typeof APP_VERSION!=='undefined'?APP_VERSION:''),
      meta:{
        fileName:currentFileName||'',
        fileSize:currentFileSize||0,
        fileKey:fk
      },
      strokes:(typeof strokes!=='undefined'?strokes:[]),
      dims:(typeof dims!=='undefined'?dims:[]),
      savedViews:(typeof savedViews!=='undefined'?savedViews:[null,null,null,null,null]),
      hiddenLayers:(typeof hiddenLayers!=='undefined'?[...hiddenLayers]:[])
    };
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const base=(currentFileName||'').replace(/\.[^.]+$/,'')||null;
    const fname=(base?base+'_書込み':'書込み')+'.dxfview';
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=fname;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},2000);
    if(typeof verify==='function')verify('バックアップ保存',{strokes:typeof strokes!=='undefined'?strokes.length:-1,dims:typeof dims!=='undefined'?dims.length:-1});
    showGuide('書込みデータを保存しました',2000);
  }catch(e){
    console.warn('[dxfview backup] failed',e);
    showGuide('バックアップ保存に失敗しました',2000);
  }
}
document.getElementById('writeBackupBtn').addEventListener('click',exportDxfviewManual);

// =========================================================
// V0_136: 書込復元（設定パネルボタン）
// .dxfview ファイルを選択して strokes / dims / savedViews / hiddenLayers を復元
// =========================================================
function importDxfviewManual(){
  if(!confirm('現在の書込み内容は上書きされます。よろしいですか？'))return;
  var input=document.createElement('input');
  input.type='file';
  input.accept='.dxfview';
  input.onchange=function(e){
    var file=e.target.files[0];
    if(!file)return;
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var d=JSON.parse(ev.target.result);
        if(!d||!d.format||(d.format!=='dxfview'&&d.format!=='dxfview-backup')){
          showGuide('無効な.dxfviewファイルです',2000);return;
        }
        if(typeof snapshot==='function')snapshot();
        if(typeof strokes!=='undefined') strokes=d.strokes||[];
        if(typeof dims!=='undefined') dims=d.dims||[];
        if(typeof savedViews!=='undefined'){
          var sv=d.savedViews||[];
          savedViews=[sv[0]||null,sv[1]||null,sv[2]||null,sv[3]||null,sv[4]||null];
        }
        if(typeof hiddenLayers!=='undefined'&&d.hiddenLayers){
          hiddenLayers=new Set(d.hiddenLayers);
        }
        // UI更新
        for(var i=0;i<5;i++){if(typeof updateViewmemoState==='function')updateViewmemoState(i);}
        if(typeof buildLayerModal==='function')buildLayerModal();
        if(typeof scheduleDraw==='function')scheduleDraw(); // V0_138: 書込復元後にDXF本体Canvasを再描画
        if(typeof scheduleOverlay==='function')scheduleOverlay();
        if(typeof updateUndoRedo==='function')updateUndoRedo();
        if(typeof scheduleSave==='function')scheduleSave();
        if(typeof verify==='function')verify('バックアップ復元:done');
        showGuide('書込みデータを復元しました',2000);
      }catch(err){
        console.warn('[dxfview import] failed',err);
        showGuide('.dxfview読み込みに失敗しました',2000);
      }
    };
    reader.readAsText(file,'UTF-8');
  };
  input.click();
}
document.getElementById('importDxfviewBtn').addEventListener('click',importDxfviewManual);

// =========================================================
// V0_123: ハイブリッドPDF書き出し（DXFベクター + 手書き/寸法ラスター）
// 試験実装。設定パネルの「HD-PDF書出」ボタンから使用。
// DXF線分・円弧 → jsPDFベクター描画（解像度無制限）
// 手書き・寸法   → 透過PNGで重ねる（座標系共通で位置ずれなし）
// V0_124: 日本語フォント外部ファイル（fonts/NotoSansJP.js）から動的ロード
// =========================================================

// V0_124: 日本語フォント動的ロード（fonts/NotoSansJP.js → window._notoSansJPBase64）
var _jpFontLoaded=false;
function _loadJPFont(){
  return new Promise(function(resolve){
    if(_jpFontLoaded||window._notoSansJPBase64){_jpFontLoaded=true;resolve();return;}
    var s=document.createElement('script');
    s.src='./fonts/NotoSansJP.js';
    s.onload=function(){_jpFontLoaded=true;resolve();};
    s.onerror=function(){console.warn('[HybridPDF] フォント読み込み失敗');resolve();};
    document.head.appendChild(s);
  });
}

async function exportHybridPDF(){
  const btn=document.getElementById('hybridPDFBtn');
  btn.disabled=true;
  showGuide('HD-PDFを生成中...');
  try{
    // V0_124: 日本語フォントを事前ロード
    await _loadJPFont();

    // ── 1. バウンディングボックス（現行PDFと同じロジック）──
    var _hMnX=Infinity,_hMnY=Infinity,_hMxX=-Infinity,_hMxY=-Infinity;
    function _hExp(x,y){if(!isFinite(x)||!isFinite(y))return;if(x<_hMnX)_hMnX=x;if(y<_hMnY)_hMnY=y;if(x>_hMxX)_hMxX=x;if(y>_hMxY)_hMxY=y;}
    if(doc){
      for(const e of doc.sen){_hExp(e.x1,e.y1);_hExp(e.x2,e.y2);}
      for(const e of doc.enko){const r=e.rx||e.r||0;_hExp(e.cx-r,e.cy-r);_hExp(e.cx+r,e.cy+r);}
      for(const e of (doc.ten||[])){_hExp(e.x,e.y);}
      for(const e of (doc.moji||[])){_hExp(e.x,e.y);}
      for(const e of (doc.solid||[])){for(const p of e.pts)_hExp(p.x,p.y);}
    }
    if(typeof pdfImage!=='undefined'&&pdfImage){_hExp(pdfImage.wx,pdfImage.wy);_hExp(pdfImage.wx+pdfImage.ww,pdfImage.wy-pdfImage.wh);}
    for(const img of (typeof images!=='undefined'?images:[])){_hExp(img.wx,img.wy);_hExp(img.wx+img.ww,img.wy-img.wh);}
    for(const s of strokes)for(const p of s.pts)_hExp(p.x,p.y);
    for(const d of dims){
      for(const l of(d.lines||[])){_hExp(l.x1,l.y1);_hExp(l.x2,l.y2);}
      if(d.tx!=null&&d.ty!=null)_hExp(d.tx,d.ty);
    }
    if(!isFinite(_hMnX)){showGuide('描画データがありません',2000);return;}

    // ── 2. ページ・キャンバスサイズ決定（現行PDFと同じ定数）──
    const PAD=0.02;
    const eW=_hMxX-_hMnX, eH=_hMxY-_hMnY;
    const extMinX=_hMnX-eW*PAD, extMinY=_hMnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);
    const LONG_PX=6500;
    const aspect=extW/extH;
    const CW=aspect>=1?LONG_PX:Math.round(LONG_PX*aspect);
    const CH=aspect>=1?Math.round(LONG_PX/aspect):LONG_PX;
    const PDF_LONG_MM=297;
    const pageMM_W=aspect>=1?PDF_LONG_MM:Math.round(PDF_LONG_MM*aspect);
    const pageMM_H=aspect>=1?Math.round(PDF_LONG_MM/aspect):PDF_LONG_MM;
    const pdfScale=Math.min(CW/extW, CH/extH);

    // ── 3. 座標変換（ベクター・ラスター共通で位置ずれゼロ保証）──
    // キャンバス用: tx_p/ty_p をグローバルに設定 → drawAnnotation/drawOverlay が使用
    // ベクター用:   w2mx/w2my が同じ基点から mm に変換
    // 検証: w2mx(wx) = (wx*pdfScale + tx_p) * (pageMM_W/CW)
    //       w2my(wy) = (-wy*pdfScale + ty_p) * (pageMM_H/CH)
    const tx_p = -extMinX * pdfScale;
    const ty_p =  CH + extMinY * pdfScale;
    const _sx = pageMM_W / CW;
    const _sy = pageMM_H / CH;
    const w2mx = wx => ( wx * pdfScale + tx_p) * _sx;
    const w2my = wy => (-wy * pdfScale + ty_p) * _sy;

    // ── 4. グローバル状態退避・PDF用設定 ──
    const sv={tx,ty,scale};
    const dprSave=window.devicePixelRatio||1;
    const ovEl=document.getElementById('ov');
    tx=tx_p; ty=ty_p; scale=pdfScale;
    Object.defineProperty(window,'devicePixelRatio',{get:()=>1,configurable:true});

    // 透過キャンバス（手書き用・寸法用）
    const pdfAc=document.createElement('canvas'); pdfAc.width=CW; pdfAc.height=CH;
    const pdfAcCtx=pdfAc.getContext('2d');
    const pdfOv=document.createElement('canvas'); pdfOv.width=CW; pdfOv.height=CH;
    const pdfOvCtx=pdfOv.getContext('2d');

    // ov/octx を一時差し替え（drawOverlay が ov.width/height・octx を参照するため）
    const _svOv=window.ov, _svOctx=window.octx;
    window.ov=pdfOv; window.octx=pdfOvCtx;
    window._pdfScale=CW*dprSave/(ovEl.width||CW);

    try{
      // 手書き（strokes）を透過キャンバスへ
      if(typeof drawAnnotation==='function') drawAnnotation(pdfAcCtx);
      // 寸法（dims）を透過キャンバスへ
      if(typeof drawOverlay==='function') drawOverlay();
      await new Promise(r=>requestAnimationFrame(r));
    }finally{
      try{Object.defineProperty(window,'devicePixelRatio',{get:()=>dprSave,configurable:true});}catch(e){}
      window._pdfScale=undefined;
      window.ov=_svOv; window.octx=_svOctx;
      tx=sv.tx; ty=sv.ty; scale=sv.scale;
      if(typeof scheduleDraw==='function') scheduleDraw();
      if(typeof scheduleOverlay==='function') scheduleOverlay();
    }

    // ── 5. jsPDF 生成 ──
    if(typeof window.jspdf==='undefined'){showGuide('jsPDFが読み込まれていません',2000);return;}
    const {jsPDF}=window.jspdf;
    const orient=pageMM_W>=pageMM_H?'l':'p';
    const pdf=new jsPDF({orientation:orient,unit:'mm',format:[pageMM_W,pageMM_H],compress:true});

    // 白背景
    pdf.setFillColor(255,255,255);
    pdf.rect(0,0,pageMM_W,pageMM_H,'F');

    // 色設定ヘルパー（e.color は {r,g,b} オブジェクト。白背景用に近白色は黒に変換）
    function _setPdfColor(col){
      const css=(typeof rgbCss==='function')?rgbCss(col,false):'rgb(0,0,0)';
      let r=0,g=0,b=0;
      const m=css.match(/rgb\((\d+),(\d+),(\d+)\)/);
      if(m){r=+m[1];g=+m[2];b=+m[3];}
      else if(css.length>=7&&css[0]==='#'){r=parseInt(css.slice(1,3),16);g=parseInt(css.slice(3,5),16);b=parseInt(css.slice(5,7),16);}
      pdf.setDrawColor(r,g,b);
    }

    // 線幅ヘルパー（現行canvas算出式と同じ: max(0.8, lw*scale*1.4) px → mm変換）
    function _lwMM(lw){
      return Math.max(0.1, Math.max(0.8,(lw||0)*pdfScale*1.4)*_sx);
    }

    // ── 6. DXF線分（sen）ベクター描画 ──
    if(doc&&doc.sen){
      for(const e of doc.sen){
        if(hiddenLayers.has(e.layer)) continue;
        _setPdfColor(e.color);
        pdf.setLineWidth(_lwMM(e.lw));
        pdf.line(w2mx(e.x1),w2my(e.y1),w2mx(e.x2),w2my(e.y2));
      }
    }

    // ── 7. DXF円・円弧（enko）ベクター描画 ──
    if(doc&&doc.enko){
      for(const e of doc.enko){
        if(hiddenLayers.has(e.layer)) continue;
        _setPdfColor(e.color);
        pdf.setLineWidth(_lwMM(e.lw));
        const r=e.rx||e.r||0; if(r<=0) continue;
        const a1=e.a1!=null?e.a1:0, a2=e.a2!=null?e.a2:360;
        const cxmm=w2mx(e.cx), cymm=w2my(e.cy);
        const rMM=r*pdfScale*_sx;
        if(a1===0&&a2===360){
          pdf.circle(cxmm,cymm,rMM,'S');
        }else{
          const rad1=a1*Math.PI/180;
          let rad2=a2*Math.PI/180;
          if(rad2<=rad1) rad2+=2*Math.PI;
          const N=36;
          let px0=cxmm+rMM*Math.cos(rad1), py0=cymm-rMM*Math.sin(rad1);
          for(let i=1;i<=N;i++){
            const a=rad1+(rad2-rad1)*i/N;
            const px1=cxmm+rMM*Math.cos(a), py1=cymm-rMM*Math.sin(a);
            pdf.line(px0,py0,px1,py1);
            px0=px1; py0=py1;
          }
        }
      }
    }

    // ── 7.5 文字（moji）をjsPDFベクター描画（V0_124: 日本語フォント対応）──
    if(doc&&doc.moji&&doc.moji.length>0&&window._notoSansJPBase64){
      try{
        pdf.addFileToVFS('NotoSansJP.ttf',window._notoSansJPBase64);
        pdf.addFont('NotoSansJP.ttf','NotoSansJP','normal');
      }catch(er){}
      for(const e of doc.moji){
        if(hiddenLayers.has(e.layer)) continue;
        if(!e.text||!e.text.trim()) continue;
        const xmm=w2mx(e.x);
        const ymm=w2my(e.y);
        const fsMM=e.h*pdfScale*_sx;
        if(fsMM<0.3) continue;
        const css=(typeof rgbCss==='function')?rgbCss(e.color,false):'rgb(0,0,0)';
        const mc=css.match(/rgb\((\d+),(\d+),(\d+)\)/);
        if(mc) pdf.setTextColor(+mc[1],+mc[2],+mc[3]);
        pdf.setFont('NotoSansJP','normal');
        pdf.setFontSize(fsMM*(72/25.4));
        const lines=e.text.split('\n');
        for(let i=0;i<lines.length;i++){
          if(!lines[i].trim()) continue;
          const opts={baseline:'alphabetic'};
          if(e.angle&&Math.abs(e.angle)>0.1) opts.angle=e.angle;
          pdf.text(lines[i],xmm,ymm-fsMM*i,opts);
        }
      }
      pdf.setTextColor(0,0,0);
    }

    // ── 8. 手書き（strokes）を透過PNGで重ねる ──
    const strokesPng=pdfAc.toDataURL('image/png');
    pdf.addImage(strokesPng,'PNG',0,0,pageMM_W,pageMM_H);

    // ── 9. 寸法（dims）を透過PNGで重ねる ──
    const dimsPng=pdfOv.toDataURL('image/png');
    pdf.addImage(dimsPng,'PNG',0,0,pageMM_W,pageMM_H);

    // ── 10. 保存 ──
    const fname=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+'_hd.pdf';
    pdf.save(fname);
    showGuide('HD-PDFを保存しました',2000);

  }catch(err){
    console.error('[HybridPDF]',err);
    showGuide('HD-PDF出力に失敗しました: '+err.message,3000);
  }finally{
    btn.disabled=false;
  }
}
document.getElementById('hybridPDFBtn').addEventListener('click',exportHybridPDF);

// V0_126: PDF解像度倍率（1x/2x/3x）
var _pdfResMulti=1;
(function(){
  var btns=[
    {id:'pdfRes1Btn',v:1},
    {id:'pdfRes2Btn',v:2},
    {id:'pdfRes3Btn',v:3}
  ];
  function setRes(v){
    _pdfResMulti=v;
    btns.forEach(function(b){
      var el=document.getElementById(b.id);
      if(el) el.classList.toggle('active',b.v===v);
    });
  }
  btns.forEach(function(b){
    var el=document.getElementById(b.id);
    if(el) el.addEventListener('click',function(){setRes(b.v);});
  });
})();
