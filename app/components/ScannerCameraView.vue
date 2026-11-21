<script setup lang="ts">
import { mdiCameraOutline, mdiCheck, mdiPause } from '@mdi/js'
import type { useCamera } from '~/composables/useCamera'
import type { useScanner } from '~/composables/useScanner'
const props = defineProps<{ camera: ReturnType<typeof useCamera>; scanner: ReturnType<typeof useScanner>; mirror: boolean }>()
const { videoRef, stream } = props.camera
const { analysis, state, message, qrIssue } = props.scanner
const dimensions = computed(() => ({ width: analysis.value?.width || videoRef.value?.videoWidth || 1920, height: analysis.value?.height || videoRef.value?.videoHeight || 1080 }))
const polygon = computed(() => analysis.value?.quad?.map(point => `${point.x},${point.y}`).join(' ') || '')
const markersCount = computed(() => analysis.value?.markers.length || 0)
</script>
<template>
  <section class="camera-panel">
    <div class="video-stage" :class="{ 'has-image': !!stream }">
      <div class="preview-image-layer" :class="{ mirrored: mirror }">
        <video ref="videoRef" autoplay playsinline muted />
        <svg v-if="polygon || markersCount" class="page-overlay" :viewBox="`0 0 ${dimensions.width} ${dimensions.height}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <polygon v-if="polygon" :points="polygon" />
          <circle v-for="(point, index) in analysis?.quad" :key="index" :cx="point.x" :cy="point.y" :r="Math.max(dimensions.width / 180, 4)" />
          <polygon v-for="(marker, index) in analysis?.markers" :key="marker.id + index" :points="marker.corners.map(point => `${point.x},${point.y}`).join(' ')" style="stroke:#82ef9f;fill:#82ef9f22;stroke-width:2;vector-effect:non-scaling-stroke" />
        </svg>
      </div>
      <div v-if="!stream" class="empty-preview"><v-icon :icon="mdiCameraOutline" size="40" /><p>Нажмите «Старт», чтобы включить камеру</p></div>
      <div v-if="stream && state === 'wait-clear'" class="capture-toast"><v-icon :icon="mdiCheck" size="18" /><span>Страница сохранена. Уберите лист</span></div>
      <div v-if="stream && state === 'paused'" class="pause-shade"><v-icon :icon="mdiPause" /><span>Сканирование на паузе</span></div>
    </div>
    <div class="capture-status" aria-live="polite">{{ qrIssue || message }}</div>
  </section>
</template>
<style scoped>
.camera-panel { --border:#314035; --yellow:#ffdc61; color:#dce8df; background:#19241c; border:1px solid var(--border); border-radius:15px; overflow:hidden; }
.video-stage{position:relative;aspect-ratio:16/9;min-height:340px;background:radial-gradient(ellipse at 50% 50%,#202b24 0%,#151d18 70%);overflow:hidden}
.preview-image-layer{position:absolute;inset:0;transform-origin:center}
.preview-image-layer.mirrored{transform:scaleX(-1)}
.preview-image-layer video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.page-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.page-overlay polygon{fill:#ffdc610a;stroke:var(--yellow);stroke-width:3;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.page-overlay circle{fill:var(--yellow);stroke:#5a4611;stroke-width:1;vector-effect:non-scaling-stroke}
.preview-corner-label{position:absolute;left:17px;top:16px;display:flex;gap:8px;pointer-events:none}
.preview-corner-label span { background:#111b14b3; border:1px solid #485b4c; border-radius:4px; padding:5px 7px; font-size:10px; }
.capture-toast{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:9px;align-items:center;background:#1d2b19ed;color:#dff7bb;border:1px solid #708357;padding:10px 15px;border-radius:7px;font-size:12px;white-space:nowrap}
.pause-shade{position:absolute;inset:0;background:#111811a6;display:flex;align-items:center;justify-content:center;gap:12px;font-size:15px;backdrop-filter:blur(3px)}
.preview-toolbar{height:48px;padding:0 21px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
.preview-label{display:flex;align-items:center;gap:8px;font-size:11px;color:#b6c2b9}
.resolution{font-size:10px;color:#809287}
.empty-preview{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
.empty-preview h3 { margin:16px 0 10px; font-size:18px; font-weight:500; }
.empty-preview p { font-size:13px; line-height:1.6; color:#8fa294; }
.capture-status { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 21px; border-top:1px solid var(--border); font-size:13px; }
.capture-status > span { font-size:11px; color:#8fa294; }
@media(min-width:1600px){.video-stage{min-height:440px}}
@media(max-width:1100px){.video-stage{min-height:320px}}
@media(max-width:800px){.video-stage{min-height:380px}}
@media(max-width:520px){.video-stage{min-height:330px;aspect-ratio:4/3}.capture-toast{font-size:10px;padding:9px 11px;max-width:95%;white-space:normal}}
</style>
