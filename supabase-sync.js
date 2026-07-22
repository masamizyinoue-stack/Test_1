// supabase-sync.js — 図面ごとの注記(strokes/dims)をSupabaseへ自動保存・自動復元する（V1_03）
// 依存: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> をindex.htmlで先に読み込むこと
// 依存グローバル: strokes, dims, currentFileIdx, openFiles, currentFileName, currentFileSize (viewer.js/HTML)
//
// 設計方針（安全側）:
// ・ネットワークが無い/失敗しても既存のローカル保存(localStorage/IndexedDB)には一切影響を与えない
//   （すべてtry/catchで囲み、失敗時はconsole.warnのみでUIを止めない）
// ・自動保存: 既存のdoSave()実行のたびに、現在開いているファイルのstrokes/dimsを
//   Supabaseへ非同期でupsert（file_key + device_idで1レコード）
// ・自動復元: ファイルを新しく開いた際、ローカルに注記(strokes/dims)が無い場合のみ
//   Supabaseから復元を試みる（ローカルに既にある注記をクラウドの古いデータで
//   上書きしてしまわないようにするため）
// ・V1_02: 「人・端末ごとに注記を分離したい」という要望により、file_keyだけでなく
//   端末固有のdevice_idも複合キーに含めるよう変更。他の人・他のiPadで同じ図面を
//   開いても、device_idが異なるため別レコードとして扱われ、互いの注記を
//   上書きしない。
//   ※device_idはこのブラウザのlocalStorageに保存される「自己申告のID」であり、
//   Supabase側のRLSはこのIDを検証していない（真の認証ではない）。社内の
//   通常利用では他人のdevice_idを偽装される想定は低いが、厳密なアクセス制御
//   （なりすまし防止）が必要な場合はSupabase Authの導入が別途必要になる。

const _SB_URL='https://opuylmqrsovtemygouwe.supabase.co';
const _SB_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wdXlsbXFyc292dGVteWdvdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjM4NDMsImV4cCI6MjEwMDIzOTg0M30.cECPW5u5FCPOlmyCWGaJi_PbaizKB2vQbsmQaOJZ5bM';
const _SB_DEVICE_ID_KEY='dxfv_device_id'; // V1_02

let _sbClient=null;
try{
  if(window.supabase&&typeof window.supabase.createClient==='function'){
    _sbClient=window.supabase.createClient(_SB_URL,_SB_ANON_KEY);
  }
}catch(e){console.warn('[SupabaseSync] クライアント初期化失敗',e);}

// アプリ内部のfileKeyは "name\x00size" だが、PostgreSQLのtext列はNUL文字(\x00)を
// 格納できず保存が必ず失敗するため、Supabase送信専用に安全な区切り文字へ変換する
function _sbSafeKey(fk){ return (fk==null)?fk:String(fk).split('\x00').join('::'); }

// V1_02: この端末固有のIDをlocalStorageから取得。無ければ生成して保存する
function _sbGetDeviceId(){
  try{
    var id=localStorage.getItem(_SB_DEVICE_ID_KEY);
    if(id) return id;
    id=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID()
      :('dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    localStorage.setItem(_SB_DEVICE_ID_KEY,id);
    return id;
  }catch(e){
    // localStorageが使えない環境（プライベートブラウズ等）では毎回一時IDを発行
    return 'dev-temp-'+Math.random().toString(36).slice(2);
  }
}
const _SB_DEVICE_ID=_sbGetDeviceId();

// 現在のファイルの注記をSupabaseへ保存（非同期・失敗しても無視）
function _sbPushCurrentAnnotations(){
  if(!_sbClient) return;
  try{
    if(typeof currentFileIdx==='undefined'||currentFileIdx<0||!openFiles[currentFileIdx]) return;
    var _f=openFiles[currentFileIdx];
    var _fk=_sbSafeKey(_f.fileKey||(typeof _fileKey==='function'?_fileKey(currentFileName,currentFileSize):null));
    if(!_fk) return;
    _sbClient.from('dxf_annotations').upsert({
      file_key:_fk,
      device_id:_SB_DEVICE_ID, // V1_02: 端末ごとに別レコードにする
      file_name:currentFileName||_f.currentFileName||_f.name||'',
      strokes:strokes||[],
      dims:dims||[]
    },{onConflict:'file_key,device_id'}).then(function(res){
      if(res&&res.error) console.warn('[SupabaseSync] 保存失敗',res.error.message);
    });
  }catch(e){console.warn('[SupabaseSync] 保存例外',e);}
}

// 指定fileKeyの注記をSupabaseから取得（この端末が過去に保存した分のみ）。無い/失敗時はnullを返す
async function _sbPullAnnotations(fileKey){
  if(!_sbClient||!fileKey) return null;
  try{
    var res=await _sbClient.from('dxf_annotations')
      .select('strokes,dims')
      .eq('file_key',_sbSafeKey(fileKey))
      .eq('device_id',_SB_DEVICE_ID) // V1_02: 自分の端末が保存したものだけを復元
      .maybeSingle();
    if(res.error){console.warn('[SupabaseSync] 復元失敗',res.error.message);return null;}
    return res.data||null;
  }catch(e){console.warn('[SupabaseSync] 復元例外',e);return null;}
}

// V1_03: 設定画面の「クラウド保存状況」表示用。dxf_annotations_stats() RPCを呼び、
// 全体の保存件数・概算サイズ・Free枠(500MB)に対する使用率を返す。失敗時はnull
async function _sbGetUsageStats(){
  if(!_sbClient) return null;
  try{
    var res=await _sbClient.rpc('dxf_annotations_stats');
    if(res.error){console.warn('[SupabaseSync] 使用状況取得失敗',res.error.message);return null;}
    var row=(res.data&&res.data[0])?res.data[0]:null;
    if(!row) return null;
    var FREE_LIMIT_BYTES=500*1024*1024; // Supabase Free Planのデータベースサイズ上限(500MB)
    return {
      rowCount:row.row_count||0,
      tableBytes:row.table_bytes||0,
      totalBytes:row.total_bytes||0,
      freeLimitBytes:FREE_LIMIT_BYTES,
      usedRatio:FREE_LIMIT_BYTES>0?(row.table_bytes||0)/FREE_LIMIT_BYTES:0
    };
  }catch(e){console.warn('[SupabaseSync] 使用状況取得例外',e);return null;}
}

window._sbPushCurrentAnnotations=_sbPushCurrentAnnotations;
window._sbPullAnnotations=_sbPullAnnotations;
window._sbGetUsageStats=_sbGetUsageStats;
