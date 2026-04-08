import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'

// ── 상수 ──────────────────────────────────────────────────────────
const IR_FACTOR = { LOW: 0.6, MEDIUM: 1.0, HIGH: 1.4 }
const RESOLUTIONS = {
  LOW:    { w: 640,  h: 480  },
  MEDIUM: { w: 1280, h: 720  },
  HIGH:   { w: 1920, h: 1080 },
}
const DEFAULT_OPTIONS = {
  brightness: 0, contrast: 0, saturation: 0,
  intensity: 'MEDIUM', warmTone: 50, filmGrain: 40, vignette: 55, resolution: 'MEDIUM',
}

// ── getUserMedia 헬퍼 ─────────────────────────────────────────────
const getGetUserMedia = () => {
  if (typeof window === 'undefined') return null
  const nav = window.navigator
  if (!nav) return null
  if (nav.mediaDevices?.getUserMedia) return c => nav.mediaDevices.getUserMedia(c)
  if (nav.webkitGetUserMedia) return c => new Promise((res, rej) => nav.webkitGetUserMedia(c, res, rej))
  if (nav.mozGetUserMedia)    return c => new Promise((res, rej) => nav.mozGetUserMedia(c, res, rej))
  return null
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
  const [permission,   setPermission]   = useState('initial')
  const [cameraReady,  setCameraReady]  = useState(false)
  const [hasStream,    setHasStream]    = useState(false)
  const [facingMode,   setFacingMode]   = useState('environment')
  const [errorMessage, setErrorMessage] = useState('')

  const [mode,             setMode]             = useState('infrared')
  const [flash,            setFlash]            = useState(false)
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
  const [resolution,  setResolution]  = useState(DEFAULT_OPTIONS.resolution)

  const [zoomScale,   setZoomScale]   = useState(1)
  const [hwZoom,      setHwZoom]      = useState(false)   // 하드웨어 줌 사용 중 여부
  const [focusPoint,  setFocusPoint]  = useState({ x: 0, y: 0, key: 0, show: false })
  const hwZoomRef = useRef(false)   // 렌더 없이 캡처·포커스에서 동기 참조

  const videoRef        = useRef(null)
  const streamRef       = useRef(null)
  const canvasRef       = useRef(null)
  const hiddenCanvasRef = useRef(null)
  const fileInputRef    = useRef(null)
  const rawCaptureRef   = useRef(null)
  const touchRef        = useRef({ pinchDist:0, pinchScale:1, tapX:0, tapY:0, tapTime:0, tapMoved:false })
  const focusTimerRef   = useRef(null)
  const zoomTimerRef    = useRef(null)
  const [showZoom, setShowZoom] = useState(false)

  const getUserMediaFn = getGetUserMedia()

  // ── 뷰파인더 CSS 필터 ──────────────────────────────────────────
  const liveFilter = useMemo(() => {
    const b = 1 + brightness / 100
    const c = 1 + contrast   / 100
    const s = mode === 'infrared' ? 0.1 : Math.max(0, 1 + saturation / 100)
    return { filter: `brightness(${b.toFixed(2)}) contrast(${c.toFixed(2)}) saturate(${s.toFixed(2)})` }
  }, [brightness, contrast, saturation, mode])

  // ── 터치: 핀치줌 + 탭 초점 ────────────────────────────────────
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      touchRef.current.pinchDist  = Math.hypot(dx, dy)
      touchRef.current.pinchScale = zoomScale
    } else if (e.touches.length === 1) {
      touchRef.current.tapX     = e.touches[0].clientX
      touchRef.current.tapY     = e.touches[0].clientY
      touchRef.current.tapTime  = Date.now()
      touchRef.current.tapMoved = false
    }
  }, [zoomScale])

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist  = Math.hypot(dx, dy)
      const scale = touchRef.current.pinchScale * (dist / touchRef.current.pinchDist)
      const next  = Math.min(6, Math.max(1, scale))
      setZoomScale(next)

      // 하드웨어 줌 시도 (선명도 유지) — 실패 시 CSS scale 폴백
      const track = streamRef.current?.getVideoTracks()[0]
      if (track) {
        track.applyConstraints({ advanced: [{ zoom: next }] })
          .then(() => { hwZoomRef.current = true; setHwZoom(true) })
          .catch(() => { hwZoomRef.current = false; setHwZoom(false) })
      }

      clearTimeout(zoomTimerRef.current)
      setShowZoom(true)
      zoomTimerRef.current = setTimeout(() => setShowZoom(false), 1500)
    } else if (e.touches.length === 1) {
      const dx = Math.abs(e.touches[0].clientX - touchRef.current.tapX)
      const dy = Math.abs(e.touches[0].clientY - touchRef.current.tapY)
      if (dx > 8 || dy > 8) touchRef.current.tapMoved = true
    }
  }, [])

  const handleTouchEnd = useCallback(async (e) => {
    const { tapX, tapY, tapTime, tapMoved } = touchRef.current
    const dt = Date.now() - tapTime
    if (e.changedTouches.length === 1 && !tapMoved && dt < 320) {
      const rect = e.currentTarget.getBoundingClientRect()
      const x    = e.changedTouches[0].clientX - rect.left
      const y    = e.changedTouches[0].clientY - rect.top
      const relX = Math.max(0, Math.min(1, x / rect.width))
      const relY = Math.max(0, Math.min(1, y / rect.height))

      clearTimeout(focusTimerRef.current)
      setFocusPoint(p => ({ x, y, key: p.key + 1, show: true, status: 'seeking' }))

      const track = streamRef.current?.getVideoTracks()[0]
      let focusOk = false

      if (track) {
        // ── 정확한 센서 좌표 계산 ───────────────────────────────────
        // 하드웨어 줌 활성 시: 비디오 프레임 자체가 이미 줌된 상태 → CSS scale 역변환 불필요
        // CSS 줌 폴백 시: scale(zoomScale) 역변환 필요
        const adjX = hwZoomRef.current
          ? relX
          : Math.max(0, Math.min(1, 0.5 + (relX - 0.5) / zoomScale))
        const adjY = hwZoomRef.current
          ? relY
          : Math.max(0, Math.min(1, 0.5 + (relY - 0.5) / zoomScale))

        // object-fit:cover 역변환 — 실제 비디오 픽셀 기준 센서 좌표
        const vw = videoRef.current?.videoWidth  || rect.width
        const vh = videoRef.current?.videoHeight || rect.height
        const cw = rect.width, ch = rect.height
        const coverScale = Math.max(cw / vw, ch / vh)
        const visW = cw / coverScale
        const visH = ch / coverScale
        const offX = (vw - visW) / 2 / vw
        const offY = (vh - visH) / 2 / vh

        const sensorX = Math.max(0, Math.min(1, offX + adjX * (visW / vw)))
        const sensorY = Math.max(0, Math.min(1, offY + adjY * (visH / vh)))
        const poi = { x: sensorX, y: sensorY }

        // ── focus 전략 ─────────────────────────────────────────────
        // Samsung Android: manual 킥 → 50ms 대기 → single-shot+AE 번들
        // AE(노출)도 함께 요청해야 삼성에서 실제 AF sweep이 일어남
        try { await track.applyConstraints({ advanced: [{ focusMode: 'manual', exposureMode: 'manual' }] }) } catch {}
        await new Promise(r => setTimeout(r, 60))   // 삼성: 리셋 후 딜레이 필수

        // 1안: single-shot AF + AE 번들 + POI
        if (!focusOk) try {
          await track.applyConstraints({ advanced: [{
            focusMode:    'single-shot',
            exposureMode: 'single-shot',
            pointOfInterest: poi,
          }] })
          focusOk = true
        } catch {}

        // 2안: single-shot AF만
        if (!focusOk) try {
          await track.applyConstraints({ advanced: [{ focusMode: 'single-shot', pointOfInterest: poi }] })
          focusOk = true
        } catch {}

        // 3안: continuous + POI (리셋 효과)
        if (!focusOk) try {
          await track.applyConstraints({ advanced: [{
            focusMode: 'continuous', exposureMode: 'continuous', pointOfInterest: poi,
          }] })
          focusOk = true
        } catch {}

        // 4안: ImageCapture API (pointsOfInterest 복수형)
        if (!focusOk && typeof ImageCapture !== 'undefined') try {
          const ic = new ImageCapture(track)
          await ic.setOptions({ focusMode: 'single-shot', pointsOfInterest: [poi],
                                exposureMode: 'single-shot', exposurePointsOfInterest: [poi] })
          focusOk = true
        } catch {}

        // 5안: continuous 재트리거 (AE+WB 포함)
        if (!focusOk) try {
          await track.applyConstraints({ advanced: [{
            focusMode: 'continuous', exposureMode: 'continuous', whiteBalanceMode: 'continuous',
          }] })
          focusOk = true
        } catch {}

        if (focusOk) {
          setFocusPoint(p => ({ ...p, status: 'locked' }))
          // 4s 후 continuous 복귀 — 잠금 충분히 유지
          focusTimerRef.current = setTimeout(async () => {
            setFocusPoint(p => ({ ...p, show: false }))
            try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous', exposureMode: 'continuous' }] }) } catch {}
          }, 4000)
        } else {
          setFocusPoint(p => ({ ...p, status: 'auto' }))
          focusTimerRef.current = setTimeout(() => setFocusPoint(p => ({ ...p, show: false })), 900)
        }
      } else {
        focusTimerRef.current = setTimeout(() => setFocusPoint(p => ({ ...p, show: false })), 1000)
      }
    }
  }, [zoomScale])

  const handleDoubleTap = useCallback(() => {
    setZoomScale(1)
    hwZoomRef.current = false; setHwZoom(false)
    const track = streamRef.current?.getVideoTracks()[0]
    if (track) track.applyConstraints({ advanced: [{ zoom: 1 }] }).catch(() => {})
    setShowZoom(true)
    clearTimeout(zoomTimerRef.current)
    zoomTimerRef.current = setTimeout(() => setShowZoom(false), 800)
  }, [])

  // ── 스트림 → video 연결 (폴백) ───────────────────────────────
  useEffect(() => {
    if (!hasStream || !streamRef.current) return
    const v = videoRef.current; if (!v) return
    if (!v.srcObject) v.srcObject = streamRef.current
    v.play().catch(() => {})
  }, [hasStream])

  // ── 카메라 초기화 ─────────────────────────────────────────────
  const initializeCamera = useCallback(async (facing, res) => {
    const f = facing ?? facingMode
    const { w, h } = RESOLUTIONS[res ?? resolution]
    if (!getUserMediaFn) { setPermission('error'); setErrorMessage('이 브라우저는 카메라를 지원하지 않습니다.'); return }
    setErrorMessage(''); setPermission('prompting'); setCameraReady(false)
    try {
      let stream
      try {
        stream = await getUserMediaFn({
          video: f === 'user'
            ? { facingMode: 'user', width: { ideal: w }, height: { ideal: h } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: w }, height: { ideal: h } },
          audio: false
        })
      } catch {
        stream = await getUserMediaFn({
          video: { facingMode: f === 'user' ? 'user' : 'environment' }, audio: false
        })
      }
      streamRef.current = stream
      const v = videoRef.current
      if (v) { v.srcObject = stream; v.play().catch(() => {}) }
      // 스트림 시작 즉시 continuous AF 요청
      try {
        await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
      } catch {}
      setCameraReady(true); setPermission('granted'); setHasStream(true)
    } catch (err) {
      const map = {
        NotAllowedError:      ['denied', '카메라 접근이 거부되었습니다.'],
        PermissionDeniedError:['denied', '카메라 접근이 거부되었습니다.'],
        NotFoundError:        ['error',  '카메라를 찾을 수 없습니다.'],
        NotReadableError:     ['error',  '카메라가 다른 앱에서 사용 중입니다.'],
      }
      const [p, m] = map[err.name] ?? ['error', '카메라 오류: ' + err.name]
      setPermission(p); setErrorMessage(m)
    }
  }, [facingMode, resolution, getUserMediaFn])

  const handleRetry = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setHasStream(false); setCameraReady(false); setPermission('initial')
  }, [])
  const resetOptions = useCallback(() => {
    setBrightness(0); setContrast(0); setSaturation(0)
    setIntensity('MEDIUM'); setWarmTone(50); setFilmGrain(40); setVignette(55)
  }, [])

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
      data[i]  = Math.min(255, Math.max(0, r|0))
      data[i+1]= Math.min(255, Math.max(0, g|0))
      data[i+2]= Math.min(255, Math.max(0, b|0))
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

      // 소프트 재질 가중치
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

  // ── 촬영 (줌 상태로 크롭 캡처) ───────────────────────────────
  const capturePhoto = useCallback(async () => {
    const canvas = hiddenCanvasRef.current
    const ctx    = canvas.getContext('2d')

    {
      if (!videoRef.current || !cameraReady) return
      setShowCaptureFlash(true); setTimeout(()=>setShowCaptureFlash(false),150)
      const v = videoRef.current
      const track = streamRef.current?.getVideoTracks()[0]

      // ImageCapture.takePhoto() — 카메라 하드웨어 ISP(샤프닝·노이즈 감소) 활용, 풀 해상도
      let usedImageCapture = false
      if (track && typeof ImageCapture !== 'undefined') {
        try {
          const ic = new ImageCapture(track)
          const blob = await ic.takePhoto()
          const bitmap = await createImageBitmap(blob)
          if (hwZoomRef.current) {
            canvas.width=bitmap.width; canvas.height=bitmap.height
            ctx.drawImage(bitmap, 0, 0)
          } else {
            // CSS 줌인 경우 중앙 크롭
            const sw = Math.round(bitmap.width/zoomScale), sh = Math.round(bitmap.height/zoomScale)
            const sx = Math.round((bitmap.width-sw)/2),    sy = Math.round((bitmap.height-sh)/2)
            canvas.width=sw; canvas.height=sh
            ctx.drawImage(bitmap, sx,sy,sw,sh, 0,0,sw,sh)
          }
          bitmap.close()
          usedImageCapture = true
        } catch {}
      }

      if (!usedImageCapture) {
        // 폴백: 비디오 프레임 직접 캡처
        if (hwZoomRef.current) {
          canvas.width=v.videoWidth; canvas.height=v.videoHeight
          ctx.drawImage(v, 0,0)
        } else {
          const sw = Math.round(v.videoWidth/zoomScale), sh = Math.round(v.videoHeight/zoomScale)
          const sx = Math.round((v.videoWidth-sw)/2),    sy = Math.round((v.videoHeight-sh)/2)
          canvas.width=sw; canvas.height=sh
          ctx.drawImage(v, sx,sy,sw,sh, 0,0,sw,sh)
        }
      }
    }

    rawCaptureRef.current = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    setAiUsed(false); setAiDescription(null)

    const w=canvas.width, h=canvas.height
    const warmFactor = warmTone/100*0.12
    const noiseAmt   = filmGrain/100*20
    const vigAmt     = vignette/100*0.7
    let imageData = ctx.getImageData(0,0,w,h)

    if (mode === 'infrared') {
      imageData = applyInfraredFilter(imageData, intensity, warmFactor)
      if (brightness!==0||contrast!==0)
        imageData = applyCommonAdjustments(imageData, brightness, contrast, 0)
      ctx.putImageData(imageData,0,0)
      addScanlinesAndNoise(ctx,w,h,noiseAmt,vigAmt)
    } else {
      if (brightness!==0||contrast!==0||saturation!==0)
        imageData = applyCommonAdjustments(imageData, brightness, contrast, saturation)
      ctx.putImageData(imageData,0,0)
    }
    const url = canvas.toDataURL('image/jpeg', 0.92)
    setLastCapture(url); setPreview(url)
  }, [mode, intensity, brightness, contrast, saturation, warmTone, filmGrain, vignette,
      zoomScale, hwZoom, applyInfraredFilter, applyCommonAdjustments, addScanlinesAndNoise, cameraReady])

  // ── AI 적외선 재분석 (InfraGAN 방식 + 파라미터 자동 조정) ─────
  const reanalyzeWithAI = useCallback(async () => {
    if (isAnalyzing || !rawCaptureRef.current) return
    setIsAnalyzing(true); setAiDescription(null)
    try {
      const aiParams = await analyzeWithGroq(rawCaptureRef.current)
      if (!aiParams) throw new Error('API 키가 설정되지 않았습니다')

      // AI가 제안한 파라미터 자동 적용
      if (aiParams.warm     != null) setWarmTone(Math.min(100,Math.max(0,Math.round(aiParams.warm))))
      if (aiParams.grain    != null) setFilmGrain(Math.min(100,Math.max(0,Math.round(aiParams.grain))))
      if (aiParams.vig      != null) setVignette(Math.min(100,Math.max(0,Math.round(aiParams.vig))))
      if (aiParams.intensity && ['LOW','MEDIUM','HIGH'].includes(aiParams.intensity))
        setIntensity(aiParams.intensity)

      const wf = (aiParams.warm ?? warmTone) / 100 * 0.12
      const na = (aiParams.grain ?? filmGrain) / 100 * 20
      const va = (aiParams.vig  ?? vignette)  / 100 * 0.7

      const img = new Image()
      await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=`data:image/jpeg;base64,${rawCaptureRef.current}`})
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

  const savePhoto = useCallback(()=>{
    if(!preview) return
    const a=document.createElement('a'); a.download=`IR_${Date.now()}.jpg`; a.href=preview; a.click()
    setPreview(null)
  },[preview])

  const handleGalleryPick = useCallback((e)=>{
    const file=e.target.files?.[0]; if(!file) return
    const reader=new FileReader()
    reader.onload = ev=>{
      const img=new Image()
      img.onload=()=>{
        const canvas=hiddenCanvasRef.current; const ctx=canvas.getContext('2d')
        canvas.width=img.width; canvas.height=img.height; ctx.drawImage(img,0,0)
        rawCaptureRef.current=canvas.toDataURL('image/jpeg',0.85).split(',')[1]
        setAiUsed(false); setAiDescription(null)
        const w=canvas.width,h=canvas.height
        const wf=warmTone/100*0.12,na=filmGrain/100*20,va=vignette/100*0.7
        let d=ctx.getImageData(0,0,w,h)
        if(mode==='infrared'){
          d=applyInfraredFilter(d,intensity,wf)
          if(brightness!==0||contrast!==0) d=applyCommonAdjustments(d,brightness,contrast,0)
          ctx.putImageData(d,0,0); addScanlinesAndNoise(ctx,w,h,na,va)
        } else {
          if(brightness!==0||contrast!==0||saturation!==0) d=applyCommonAdjustments(d,brightness,contrast,saturation)
          ctx.putImageData(d,0,0)
        }
        const url=canvas.toDataURL('image/jpeg',0.92); setLastCapture(url); setPreview(url)
      }
      img.src=ev.target.result
    }
    reader.readAsDataURL(file); e.target.value=''
  },[mode,intensity,brightness,contrast,saturation,warmTone,filmGrain,vignette,
     applyInfraredFilter,applyCommonAdjustments,addScanlinesAndNoise])

  const toggleCamera = useCallback(()=>{
    streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null
    setHasStream(false); setCameraReady(false)
    const nf=facingMode==='environment'?'user':'environment'
    setFacingMode(nf); initializeCamera(nf,resolution)
  },[facingMode,resolution,initializeCamera])

  const handleResolutionChange = useCallback((newRes)=>{
    setResolution(newRes)
    if(hasStream){
      streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null
      setHasStream(false); setCameraReady(false); initializeCamera(facingMode,newRes)
    }
  },[hasStream,facingMode,initializeCamera])

  // ── 에러 화면 ────────────────────────────────────────────────
  if (permission==='denied'||permission==='error') return (
    <div className="camera-container">
      <div className="error-screen">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <h2>{permission==='denied'?'카메라 권한이 거부되었습니다':'카메라 오류'}</h2>
        <p>{errorMessage}</p>
        <button className="retry-btn" onClick={handleRetry}>다시 시도</button>
      </div>
    </div>
  )

  const showOverlay = !hasStream || !cameraReady
  const zoomLabel   = zoomScale.toFixed(1).replace('.0','') + '×'

  // ── 렌더 ─────────────────────────────────────────────────────
  return (
    <div className="camera-container">

      {/* ── 뷰파인더 (전체 화면) ── */}
      <div className="camera-viewfinder"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleTap}
      >
        <video ref={videoRef} className="camera-video" playsInline muted
          onLoadedMetadata={()=>{setCameraReady(true);setPermission('granted')}}
          style={{...liveFilter, transform: hwZoom ? undefined : `scale(${zoomScale})`, transformOrigin:'center center'}}
        />
        {/* 초점 링 */}
        {focusPoint.show && (
          <div key={focusPoint.key}
            className={`focus-ring ${focusPoint.status ?? ''}`}
            style={{left:focusPoint.x, top:focusPoint.y}} />
        )}

        {/* 줌 인디케이터 */}
        {showZoom && zoomScale > 1 && (
          <div className="zoom-indicator">{zoomLabel}</div>
        )}

        {/* 권한·로딩 오버레이 */}
        {showOverlay && (
          <div className="placeholder-view" style={{position:'absolute',inset:0,zIndex:5,background:'#000'}}>
            <svg className="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            {permission==='prompting'
              ? <p className="placeholder-text">카메라 초기화 중...</p>
              : <>
                  <p className="placeholder-text">카메라 접근 권한이 필요합니다</p>
                  <button className="permission-btn" onClick={()=>initializeCamera()} style={{marginTop:20}}>카메라 허용하기</button>
                </>
            }
          </div>
        )}

        {mode==='infrared' && <div className="scan-overlay"/>}
        <canvas ref={canvasRef} className="camera-canvas"/>

        <div className={`filter-indicator ${mode==='infrared'?'ir':'photo'}`}>
          {mode==='infrared'?'INFRARED ACTIVE':'PHOTO ACTIVE'}
        </div>

        <button className={`settings-fab ${showOptions?'active':''}`}
          onClick={()=>setShowOptions(v=>!v)} title="촬영 옵션">
          <svg viewBox="0 0 24 24">
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/>
          </svg>
        </button>
      </div>

      {/* ── 모드 탭 + 셔터 (뷰파인더 위 플로팅) ── */}
      <div className="mode-shutter-bar">
        <button className={`mode-tab ${mode==='photo'?'active':''}`} onClick={()=>setMode('photo')}>PHOTO</button>
        <div className="shutter-container">
          <button className="shutter-btn" onClick={capturePhoto} disabled={isAnalyzing} aria-label="사진 촬영"/>
        </div>
        <button className={`mode-tab ${mode==='infrared'?'active':''}`} onClick={()=>setMode('infrared')}>INFRARED</button>
      </div>

      {/* ── 액션 바 (뷰파인더 위 플로팅) ── */}
      <div className="action-bar">
        <div className="thumb-slot">
          {lastCapture
            ? <img src={lastCapture} alt="마지막" className="thumbnail-img" onClick={()=>setPreview(lastCapture)}/>
            : <div className="thumb-empty"/>}
        </div>
        <div className="action-btns">
          <button className="action-btn" onClick={()=>fileInputRef.current?.click()} title="갤러리">
            <svg viewBox="0 0 24 24"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/></svg>
          </button>
          <button className={`action-btn flash-btn ${flash?'active':''}`} onClick={()=>setFlash(v=>!v)} title="플래시">
            <svg viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>
          </button>
          <button className="action-btn" onClick={toggleCamera} title="카메라 전환">
            <svg viewBox="0 0 24 24"><path d="M20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
        </div>
      </div>

      <div className={`capture-flash ${showCaptureFlash?'active':''}`}/>
      <canvas ref={hiddenCanvasRef} style={{display:'none'}}/>
      <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleGalleryPick}/>

      {/* ── 옵션 패널 ── */}
      {showOptions && (
        <>
          <div className="options-backdrop" onClick={()=>setShowOptions(false)}/>
          <div className="options-panel">
            <div className="options-header">
              <h3>촬영 옵션</h3>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button className="options-reset-btn" onClick={resetOptions}>초기화</button>
                <button className="options-close-btn" onClick={()=>setShowOptions(false)}>✕</button>
              </div>
            </div>
            <div className="option-group">
              <h4 className="option-group-title">공통</h4>
              <OptionSlider label="명도" value={brightness} min={-100} max={100} onChange={setBrightness}/>
              <OptionSlider label="대비" value={contrast}   min={-100} max={100} onChange={setContrast}/>
              <OptionSlider label="채도" value={saturation} min={-100} max={100} onChange={setSaturation} disabled={mode==='infrared'}/>
              <div className="option-row">
                <div className="option-label-row">
                  <span className="option-label">해상도</span>
                  <span className="option-value" style={{fontSize:11}}>{RESOLUTIONS[resolution].w}×{RESOLUTIONS[resolution].h}</span>
                </div>
                <div className="seg-control">
                  {[['LOW','낮음'],['MEDIUM','중간'],['HIGH','높음']].map(([v,l])=>(
                    <button key={v} className={`seg-btn ${resolution===v?'active':''}`} onClick={()=>handleResolutionChange(v)}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
            {mode==='infrared' && (
              <div className="option-group">
                <h4 className="option-group-title">적외선 전용 (AI 분석 시 자동 조정)</h4>
                <div className="option-row">
                  <div className="option-label-row"><span className="option-label">IR 강도</span></div>
                  <div className="seg-control">
                    {[['LOW','약'],['MEDIUM','중'],['HIGH','강']].map(([v,l])=>(
                      <button key={v} className={`seg-btn ${intensity===v?'active':''}`} onClick={()=>setIntensity(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <OptionSlider label="따뜻한 톤"  value={warmTone}  min={0} max={100} onChange={setWarmTone}/>
                <OptionSlider label="필름 그레인" value={filmGrain} min={0} max={100} onChange={setFilmGrain}/>
                <OptionSlider label="비네팅"      value={vignette}  min={0} max={100} onChange={setVignette}/>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 미리보기 모달 ── */}
      {preview && (
        <div className="preview-modal">
          <div className="preview-header">
            <h2>{aiUsed?'AI 적외선 변환':mode==='infrared'?'적외선 촬영':'촬영 완료'}</h2>
            <div className="preview-actions">
              <button className="preview-btn cancel" onClick={()=>setPreview(null)}>취소</button>
              <button className="preview-btn save" onClick={savePhoto}>저장</button>
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
                <div className="analyzing-spinner"/>
                <p>AI 적외선 변환 중...</p>
              </div>
            )}
            <img src={preview} alt="촬영" className="preview-image"/>
          </div>
          {!aiUsed && (
            <div className="ai-reanalyze-bar">
              <button className="ai-reanalyze-btn" onClick={reanalyzeWithAI} disabled={isAnalyzing}>
                {isAnalyzing?'🔍 AI 분석 중...':'🤖 AI로 적외선 재분석'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
