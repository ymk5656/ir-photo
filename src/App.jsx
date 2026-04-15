import React, { useState, useRef, useCallback } from 'react'

// ── 상수 ──────────────────────────────────────────────────────────
const IR_FACTOR = { LOW: 0.6, MEDIUM: 1.0, HIGH: 1.4 }
const DEFAULT_OPTIONS = {
  brightness: 0, contrast: 0, saturation: 0,
  intensity: 'MEDIUM', warmTone: 50, filmGrain: 40, vignette: 55,
}

// ── Groq Vision API + AI IR 파라미터 ──────────────────────────────
async function resizeBase64(base64, maxDim = 768) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = () => resolve(base64)
    img.src = `data:image/jpeg;base64,${base64}`
  })
}

async function analyzeWithGroq(imageBase64) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY
  if (!apiKey) return null
  const resized = await resizeBase64(imageBase64)
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 500, temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${resized}` } },
          { type: 'text', text: `Analyze this image for near-infrared (NIR 800-950nm) simulation. You are acting as InfraGAN — predict per-material NIR reflectance.

NIR physics: vegetation(chlorophyll) very bright 0.7-0.9, sky very dark, water very dark, skin medium 0.4-0.6, clouds bright, concrete/asphalt low-medium.

Also suggest optimal IR photo parameters based on scene type.

Reply with ONLY a JSON object, no markdown:
{"veg_boost":2.5,"sky_dark":0.75,"water_dark":0.85,"contrast":1.5,"skin_boost":1.3,"scene":"한국어로 장면 설명","warm":55,"grain":40,"vig":60,"intensity":"MEDIUM"}

intensity must be one of: "LOW","MEDIUM","HIGH". warm/grain/vig are 0-100.` }
        ]
      }]
    })
  })
  if (!res.ok) {
    let detail = ''
    try { const d = await res.json(); detail = d?.error?.message ?? '' } catch {}
    throw new Error(`AI API ${res.status}${detail ? ': ' + detail : ''}`)
  }
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  const text = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`응답 파싱 실패: "${text.slice(0, 60)}"`)
  return JSON.parse(match[0])
}

// ── 슬라이더 컴포넌트 ─────────────────────────────────────────────
function OptionSlider({ label, value, min, max, step = 1, onChange, disabled }) {
  const display = (value > 0 && min < 0) ? `+${value}` : String(value)
  return (
    <div className={`option-row${disabled ? ' option-row--disabled' : ''}`}>
      <div className="option-label-row">
        <span className="option-label">{label}</span>
        <span className="option-value">{display}</span>
      </div>
      <input type="range" className="option-slider"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{ '--pct': `${((value - min) / (max - min)) * 100}%` }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
function App() {
  const [mode,             setMode]             = useState('infrared')
  const [preview,          setPreview]          = useState(null)
  const [lastCapture,      setLastCapture]      = useState(null)
  const [showCaptureFlash, setShowCaptureFlash] = useState(false)

  const [isAnalyzing,   setIsAnalyzing]   = useState(false)
  const [aiDescription, setAiDescription] = useState(null)
  const [aiUsed,        setAiUsed]        = useState(false)

  const [showOptions, setShowOptions] = useState(false)
  const [brightness,  setBrightness]  = useState(DEFAULT_OPTIONS.brightness)
  const [contrast,    setContrast]    = useState(DEFAULT_OPTIONS.contrast)
  const [saturation,  setSaturation]  = useState(DEFAULT_OPTIONS.saturation)
  const [intensity,   setIntensity]   = useState(DEFAULT_OPTIONS.intensity)
  const [warmTone,    setWarmTone]    = useState(DEFAULT_OPTIONS.warmTone)
  const [filmGrain,   setFilmGrain]   = useState(DEFAULT_OPTIONS.filmGrain)
  const [vignette,    setVignette]    = useState(DEFAULT_OPTIONS.vignette)

  const hiddenCanvasRef    = useRef(null)
  const rawCaptureRef      = useRef(null)
  const nativeCaptureRef   = useRef(null)
  const fileInputRef       = useRef(null)

  // ── 공통 보정 ─────────────────────────────────────────────────
  const applyCommonAdjustments = useCallback((imageData, brt, ctr, sat) => {
    const data = imageData.data
    const bAdd = brt / 100 * 128
    const cMul = 1 + ctr / 100
    const sMul = Math.max(0, 1 + sat / 100)
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i+1], b = data[i+2]
      if (sMul !== 1) {
        const gray = 0.299*r + 0.587*g + 0.114*b
        r = gray + (r-gray)*sMul; g = gray + (g-gray)*sMul; b = gray + (b-gray)*sMul
      }
      if (bAdd !== 0) { r += bAdd; g += bAdd; b += bAdd }
      if (cMul !== 1) { r = (r-128)*cMul+128; g = (g-128)*cMul+128; b = (b-128)*cMul+128 }
      data[i]   = Math.min(255, Math.max(0, r|0))
      data[i+1] = Math.min(255, Math.max(0, g|0))
      data[i+2] = Math.min(255, Math.max(0, b|0))
    }
    return imageData
  }, [])

  // ── 표준 IR 필터 ─────────────────────────────────────────────
  const applyInfraredFilter = useCallback((imageData, intensityLevel, warmFactor) => {
    const data = imageData.data
    const factor = IR_FACTOR[intensityLevel] || 1.0
    const hist = new Array(256).fill(0)
    for (let i = 0; i < data.length; i += 4)
      hist[Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2])]++
    const cdf = [hist[0]]
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i]
    const cdfMin = cdf.find(v => v > 0) ?? 0
    const cdfRange = cdf[255] - cdfMin || 1
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2]
      const gray = 0.299*r + 0.587*g + 0.114*b
      const eq   = ((cdf[gray|0] - cdfMin) / cdfRange) * 255
      const irCh = (r*0.8 + g*0.15 + b*0.05) * factor
      const nirVal = irCh * 0.55 + eq * 0.45
      const warmth = nirVal * warmFactor
      const cont   = (nirVal - 128) * 1.3 + 128
      data[i]   = Math.min(255, Math.max(0, (cont + warmth)|0))
      data[i+1] = Math.min(255, Math.max(0, cont|0))
      data[i+2] = Math.min(255, Math.max(0, (cont - warmth*0.5)|0))
    }
    return imageData
  }, [])

  // ── AI(InfraGAN 방식) NIR 필터 ───────────────────────────────
  const applyAIInfraredFilter = useCallback((imageData, aiParams, warmFactor) => {
    const { veg_boost=2.5, sky_dark=0.75, water_dark=0.85, contrast=1.5, skin_boost=1.3 } = aiParams
    const data = imageData.data
    const hist = new Array(256).fill(0)
    for (let i = 0; i < data.length; i += 4)
      hist[Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2])]++
    const cdf = [hist[0]]
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i]
    const cdfMin = cdf.find(v => v > 0) ?? 0
    const cdfRange = cdf[255] - cdfMin || 1

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2]
      const gray = 0.299*r + 0.587*g + 0.114*b
      const eq   = ((cdf[gray|0] - cdfMin) / cdfRange) * 255
      const gDom = (g - Math.max(r,b)) / (gray+1)
      const bDom = (b - Math.max(r,g)) / (gray+1)
      const rDom = (r - Math.max(g,b)) / (gray+1)
      const vegW   = Math.min(1, Math.max(0, gDom*4) * (g>35?1:0))
      const skyW   = Math.min(1, Math.max(0, bDom*3) * (gray>60&&r<210?1:0)) * (1-vegW)
      const waterW = Math.min(1, Math.max(0, bDom*3) * (gray<140?1:0)) * (1-vegW) * (1-skyW)
      const skinW  = Math.min(1, Math.max(0, rDom*3) * (r>100&&g>60?1:0)) * (1-vegW)
      const baseW  = Math.max(0, 1-vegW-skyW-waterW-skinW)
      const vegIR   = eq + (255-eq) * Math.min(1, veg_boost*0.52)
      const skyIR   = eq * Math.max(0.03, 1-sky_dark*1.1)
      const waterIR = eq * Math.max(0.03, 1-water_dark*1.1)
      const skinIR  = Math.min(255, eq*skin_boost)
      let ir = vegIR*vegW + skyIR*skyW + waterIR*waterW + skinIR*skinW + eq*baseW
      ir = (ir-128)*contrast*1.1 + 128
      ir = Math.min(255, Math.max(0, ir|0))
      const warm = ir * warmFactor
      data[i]   = Math.min(255, (ir+warm)|0)
      data[i+1] = Math.min(255, ir)
      data[i+2] = Math.max(0,   (ir-warm)|0)
    }
    return imageData
  }, [])

  // ── 스캔라인·노이즈·비네팅 ───────────────────────────────────
  const addScanlinesAndNoise = useCallback((ctx, w, h, noiseAmt, vigAmt) => {
    ctx.fillStyle = 'rgba(0,0,0,0.06)'
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    if (noiseAmt > 0) {
      const d = ctx.getImageData(0,0,w,h); const px = d.data
      for (let i = 0; i < px.length; i += 4) {
        const n = (Math.random()-0.5)*noiseAmt
        px[i]  = Math.min(255,Math.max(0,px[i]  +n))
        px[i+1]= Math.min(255,Math.max(0,px[i+1]+n))
        px[i+2]= Math.min(255,Math.max(0,px[i+2]+n))
      }
      ctx.putImageData(d,0,0)
    }
    if (vigAmt > 0) {
      const g = ctx.createRadialGradient(w/2,h/2,0, w/2,h/2,Math.max(w,h)*0.7)
      g.addColorStop(0,'rgba(0,0,0,0)')
      g.addColorStop(1,`rgba(0,0,0,${vigAmt.toFixed(2)})`)
      ctx.fillStyle = g; ctx.fillRect(0,0,w,h)
    }
  }, [])

  // ── 소프트웨어 샤프닝 (Laplacian 커널) ───────────────────────
  const applySharpening = useCallback((ctx, w, h) => {
    const src = ctx.getImageData(0, 0, w, h).data
    const out = ctx.createImageData(w, h)
    const dst = out.data
    const s   = w * 4
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * s + x * 4
        for (let c = 0; c < 3; c++) {
          const v = src[i+c]*5 - src[i-s+c] - src[i+s+c] - src[i-4+c] - src[i+4+c]
          dst[i+c] = v < 0 ? 0 : v > 255 ? 255 : v
        }
        dst[i+3] = src[i+3]
      }
    }
    ctx.putImageData(out, 0, 0)
  }, [])

  // ── 이미지 처리 (촬영 + 갤러리 공통) ─────────────────────────
  const processImage = useCallback((img) => {
    const canvas = hiddenCanvasRef.current
    const ctx    = canvas.getContext('2d')
    canvas.width = img.width; canvas.height = img.height
    ctx.drawImage(img, 0, 0)

    applySharpening(ctx, canvas.width, canvas.height)
    rawCaptureRef.current = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    setAiUsed(false); setAiDescription(null)

    const w = canvas.width, h = canvas.height
    const warmFactor = warmTone  / 100 * 0.12
    const noiseAmt   = filmGrain / 100 * 20
    const vigAmt     = vignette  / 100 * 0.7
    let imageData    = ctx.getImageData(0, 0, w, h)

    if (mode === 'infrared') {
      imageData = applyInfraredFilter(imageData, intensity, warmFactor)
      if (brightness !== 0 || contrast !== 0)
        imageData = applyCommonAdjustments(imageData, brightness, contrast, 0)
      ctx.putImageData(imageData, 0, 0)
      addScanlinesAndNoise(ctx, w, h, noiseAmt, vigAmt)
    } else {
      if (brightness !== 0 || contrast !== 0 || saturation !== 0)
        imageData = applyCommonAdjustments(imageData, brightness, contrast, saturation)
      ctx.putImageData(imageData, 0, 0)
    }

    const url = canvas.toDataURL('image/jpeg', 0.92)
    setLastCapture(url); setPreview(url)
    setShowCaptureFlash(true); setTimeout(() => setShowCaptureFlash(false), 150)
  }, [mode, intensity, brightness, contrast, saturation, warmTone, filmGrain, vignette,
      applySharpening, applyInfraredFilter, applyCommonAdjustments, addScanlinesAndNoise])

  const handleFileLoad = useCallback((file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => processImage(img)
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  }, [processImage])

  // 네이티브 카메라 촬영 결과 처리
  const handleNativeCapture = useCallback((e) => {
    handleFileLoad(e.target.files?.[0])
    e.target.value = ''
  }, [handleFileLoad])

  // 갤러리에서 이미지 불러오기
  const handleGalleryPick = useCallback((e) => {
    handleFileLoad(e.target.files?.[0])
    e.target.value = ''
  }, [handleFileLoad])

  // ── AI 적외선 재분석 ─────────────────────────────────────────
  const reanalyzeWithAI = useCallback(async () => {
    if (isAnalyzing || !rawCaptureRef.current) return
    setIsAnalyzing(true); setAiDescription(null)
    try {
      const aiParams = await analyzeWithGroq(rawCaptureRef.current)
      if (!aiParams) throw new Error('API 키가 설정되지 않았습니다')

      if (aiParams.warm     != null) setWarmTone(Math.min(100,Math.max(0,Math.round(aiParams.warm))))
      if (aiParams.grain    != null) setFilmGrain(Math.min(100,Math.max(0,Math.round(aiParams.grain))))
      if (aiParams.vig      != null) setVignette(Math.min(100,Math.max(0,Math.round(aiParams.vig))))
      if (aiParams.intensity && ['LOW','MEDIUM','HIGH'].includes(aiParams.intensity))
        setIntensity(aiParams.intensity)

      const wf = (aiParams.warm  ?? warmTone)  / 100 * 0.12
      const na = (aiParams.grain ?? filmGrain) / 100 * 20
      const va = (aiParams.vig   ?? vignette)  / 100 * 0.7

      const img = new Image()
      await new Promise((res,rej) => { img.onload=res; img.onerror=rej; img.src=`data:image/jpeg;base64,${rawCaptureRef.current}` })
      const canvas = hiddenCanvasRef.current
      canvas.width=img.width; canvas.height=img.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0)

      let imageData = ctx.getImageData(0,0,canvas.width,canvas.height)
      imageData = applyAIInfraredFilter(imageData, aiParams, wf)
      if (brightness!==0||contrast!==0)
        imageData = applyCommonAdjustments(imageData, brightness, contrast, 0)
      ctx.putImageData(imageData,0,0)
      addScanlinesAndNoise(ctx, canvas.width, canvas.height, na, va)

      const newUrl = canvas.toDataURL('image/jpeg', 0.92)
      setPreview(newUrl); setLastCapture(newUrl)
      setAiDescription(aiParams.scene || '적외선 분석 완료')
      setAiUsed(true)
    } catch (err) {
      setAiDescription('분석 실패: ' + err.message)
    } finally {
      setIsAnalyzing(false)
    }
  }, [isAnalyzing, brightness, contrast, warmTone, filmGrain, vignette,
      applyAIInfraredFilter, applyCommonAdjustments, addScanlinesAndNoise])

  const savePhoto = useCallback(async () => {
    if (!preview) return
    const filename = `IR_${Date.now()}.jpg`
    // Web Share API: Android 공유 시트 → 갤러리 저장 가능
    if (navigator.canShare) {
      try {
        const blob = await fetch(preview).then(r => r.blob())
        const file = new File([blob], filename, { type: 'image/jpeg' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '적외선 사진' })
          setPreview(null)
          return
        }
      } catch (err) {
        if (err.name === 'AbortError') { setPreview(null); return }
        // 공유 실패 시 다운로드로 폴백
      }
    }
    // 폴백: 일반 다운로드
    const a = document.createElement('a'); a.download = filename; a.href = preview; a.click()
    setPreview(null)
  }, [preview])

  const resetOptions = useCallback(() => {
    setBrightness(0); setContrast(0); setSaturation(0)
    setIntensity('MEDIUM'); setWarmTone(50); setFilmGrain(40); setVignette(55)
  }, [])

  // ── 렌더 ─────────────────────────────────────────────────────
  return (
    <div className="camera-container">

      {/* ── 메인 영역: 마지막 촬영 결과 또는 플레이스홀더 ── */}
      <div className="camera-viewfinder">
        {lastCapture
          ? <img src={lastCapture} className="camera-video" alt="" />
          : (
            <div className="placeholder-view" style={{position:'absolute',inset:0,
              background:'linear-gradient(160deg,#0a1a0a 0%,#0a0a14 60%,#000 100%)'}}>
              {/* IR 카메라 아이콘 */}
              <svg className="placeholder-icon" viewBox="0 0 24 24" fill="none"
                stroke="rgba(255,149,0,0.45)" strokeWidth="1.2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
                <circle cx="12" cy="13" r="1.5" fill="rgba(255,149,0,0.45)" stroke="none"/>
              </svg>
              <p className="placeholder-text" style={{color:'rgba(255,255,255,0.6)'}}>
                셔터 버튼을 눌러{'\n'}삼성 카메라로 촬영하세요
              </p>
              <p style={{fontSize:11,color:'rgba(255,149,0,0.55)',textAlign:'center',
                letterSpacing:'0.05em',fontWeight:600}}>
                촬영 후 자동으로 적외선으로 변환됩니다
              </p>
            </div>
          )
        }

        {mode === 'infrared' && <div className="scan-overlay" />}

        <div className={`filter-indicator ${mode === 'infrared' ? 'ir' : 'photo'}`}>
          {mode === 'infrared' ? 'INFRARED ACTIVE' : 'PHOTO ACTIVE'}
        </div>

        <button className={`settings-fab ${showOptions ? 'active' : ''}`}
          onClick={() => setShowOptions(v => !v)} title="촬영 옵션">
          <svg viewBox="0 0 24 24">
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/>
          </svg>
        </button>
      </div>

      {/* ── 모드 탭 + 셔터 ── */}
      <div className="mode-shutter-bar">
        <button className={`mode-tab ${mode === 'photo' ? 'active' : ''}`}
          onClick={() => setMode('photo')}>PHOTO</button>
        <div className="shutter-container">
          {/* 셔터 버튼 → 삼성 네이티브 카메라 앱 호출 */}
          <button className="shutter-btn"
            onClick={() => nativeCaptureRef.current?.click()}
            disabled={isAnalyzing}
            aria-label="사진 촬영" />
        </div>
        <button className={`mode-tab ${mode === 'infrared' ? 'active' : ''}`}
          onClick={() => setMode('infrared')}>INFRARED</button>
      </div>

      {/* ── 액션 바 ── */}
      <div className="action-bar">
        <div className="thumb-slot">
          {lastCapture
            ? <img src={lastCapture} alt="마지막" className="thumbnail-img"
                onClick={() => setPreview(lastCapture)} />
            : <div className="thumb-empty" />}
        </div>
        <div className="action-btns">
          {/* 갤러리에서 기존 사진 불러오기 */}
          <button className="action-btn" onClick={() => fileInputRef.current?.click()}
            title="갤러리에서 불러오기">
            <svg viewBox="0 0 24 24">
              <path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={`capture-flash ${showCaptureFlash ? 'active' : ''}`} />
      <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />

      {/* 네이티브 카메라 앱 호출 (삼성 카메라) */}
      <input
        ref={nativeCaptureRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleNativeCapture}
      />

      {/* 갤러리 불러오기 (capture 없음) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleGalleryPick}
      />

      {/* ── 옵션 패널 ── */}
      {showOptions && (
        <>
          <div className="options-backdrop" onClick={() => setShowOptions(false)} />
          <div className="options-panel">
            <div className="options-header">
              <h3>변환 옵션</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="options-reset-btn" onClick={resetOptions}>초기화</button>
                <button className="options-close-btn" onClick={() => setShowOptions(false)}>✕</button>
              </div>
            </div>
            <div className="option-group">
              <h4 className="option-group-title">공통</h4>
              <OptionSlider label="명도"  value={brightness} min={-100} max={100} onChange={setBrightness} />
              <OptionSlider label="대비"  value={contrast}   min={-100} max={100} onChange={setContrast} />
              <OptionSlider label="채도"  value={saturation} min={-100} max={100} onChange={setSaturation}
                disabled={mode === 'infrared'} />
            </div>
            {mode === 'infrared' && (
              <div className="option-group">
                <h4 className="option-group-title">적외선 전용 (AI 분석 시 자동 조정)</h4>
                <div className="option-row">
                  <div className="option-label-row">
                    <span className="option-label">IR 강도</span>
                  </div>
                  <div className="seg-control">
                    {[['LOW','약'],['MEDIUM','중'],['HIGH','강']].map(([v,l]) => (
                      <button key={v} className={`seg-btn ${intensity === v ? 'active' : ''}`}
                        onClick={() => setIntensity(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <OptionSlider label="따뜻한 톤"  value={warmTone}  min={0} max={100} onChange={setWarmTone} />
                <OptionSlider label="필름 그레인" value={filmGrain} min={0} max={100} onChange={setFilmGrain} />
                <OptionSlider label="비네팅"      value={vignette}  min={0} max={100} onChange={setVignette} />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 미리보기 모달 ── */}
      {preview && (
        <div className="preview-modal">
          <div className="preview-header">
            <h2>{aiUsed ? 'AI 적외선 변환' : mode === 'infrared' ? '적외선 변환 완료' : '변환 완료'}</h2>
            <div className="preview-actions">
              <button className="preview-btn cancel" onClick={() => setPreview(null)}>취소</button>
              <button className="preview-btn save"   onClick={savePhoto}>저장</button>
            </div>
          </div>
          {aiDescription && (
            <div className="ai-description">
              <span className="ai-badge">AI IR</span>{aiDescription}
            </div>
          )}
          <div className="preview-image-container">
            {isAnalyzing && (
              <div className="analyzing-overlay">
                <div className="analyzing-spinner" />
                <p>AI 적외선 변환 중...</p>
              </div>
            )}
            <img src={preview} alt="촬영" className="preview-image" />
          </div>
          {!aiUsed && (
            <div className="ai-reanalyze-bar">
              <button className="ai-reanalyze-btn" onClick={reanalyzeWithAI} disabled={isAnalyzing}>
                {isAnalyzing ? '🔍 AI 분석 중...' : '🤖 AI로 적외선 재분석'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
