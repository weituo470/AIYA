import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessBuildRequest } from '../src/app/api/create-theatre/_build-routing-policy';
import {
  collectRequestedVisibleTerms,
  hasAffirmedIntent,
  isCalculatorRequest,
  isCameraInputRequest,
  isDirectionalAppRequest,
  isMicrophoneInputRequest,
  isMotionSensorRequest,
  isSnakeRequest,
  isWhistlePitchRequest,
} from '../src/app/api/create-theatre/_teacher-coder-intent';

const sameTerms = (idea: string, expected: string[]) => {
  assert.deepEqual(
    collectRequestedVisibleTerms(idea).sort(),
    [...expected].sort(),
    idea,
  );
};

sameTerms('不需要图片，也不要显示普通模式。', []);
sameTerms('图片不需要，普通模式也请移除。', []);
sameTerms('需要图片，并提供普通和困难模式。', ['图片', '普通', '困难']);
sameTerms('不要自动开始，点击开始按钮后发声。', ['开始', '发声']);
sameTerms('重置按钮不要出现，只保留清空。', ['清空']);
sameTerms('不要只有声音，还要有画面反馈。', ['声音']);
sameTerms('不只是图片，还要有动画。', ['图片']);
sameTerms('这个作品不能没有声音反馈。', ['声音']);
sameTerms('不要声音，改为显示分数。', ['分数']);
sameTerms('也不要语音、发声或声音功能。', []);
sameTerms('不要图片但需要声音反馈。', ['声音']);
sameTerms('No image button, but show a 图片 gallery.', ['图片']);

assert.equal(isMicrophoneInputRequest('不使用麦克风，也不需要录音。'), false);
assert.equal(isMicrophoneInputRequest('无需在页面中请求麦克风。'), false);
assert.equal(isMicrophoneInputRequest('点击开始后使用麦克风录音。'), true);
assert.equal(isMicrophoneInputRequest('不要自动录音，但要点击按钮后录音。'), true);
assert.equal(isMicrophoneInputRequest('不使用麦克风、录音或声音输入。'), false);

assert.equal(isCameraInputRequest('不要摄像头，所有素材本地生成。'), false);
assert.equal(isCameraInputRequest('摄像头功能不要出现。'), false);
assert.equal(isCameraInputRequest('使用前置摄像头捕获目光。'), true);
assert.equal(isCameraInputRequest('如果摄像头不可用，要显示提示。'), true);
assert.equal(isCameraInputRequest('不使用麦克风、摄像头和陀螺仪。'), false);

assert.equal(isMotionSensorRequest('无需陀螺仪，只用触摸操作。'), false);
assert.equal(isMotionSensorRequest('通过陀螺仪控制小球。'), true);
assert.equal(isMotionSensorRequest('不使用麦克风、摄像头和陀螺仪。'), false);

assert.equal(isDirectionalAppRequest('不提供方向键，也不需要软键盘。'), false);
assert.equal(isDirectionalAppRequest('这是音乐工具，放大核心控制区。'), false);
assert.equal(isDirectionalAppRequest('使用方向键控制飞船。'), true);
assert.equal(isDirectionalAppRequest('手机端提供上下左右软键盘。'), true);

assert.equal(isSnakeRequest('不是贪吃蛇，是打地鼠。'), false);
assert.equal(isSnakeRequest('做一个可以穿墙的贪吃蛇。'), true);
assert.equal(isCalculatorRequest('不要计算器，改做节拍器。'), false);
assert.equal(isCalculatorRequest('做一个儿童计算器。'), true);

assert.equal(hasAffirmedIntent('Do not use camera. Instead, use touch.', /camera/i), false);
assert.equal(hasAffirmedIntent('Do not auto start, but add a start button.', /start/i), true);
assert.equal(hasAffirmedIntent('The app cannot do without sound feedback.', /sound/i), true);
assert.equal(hasAffirmedIntent('也不要语音、发声或声音功能。', /语音|发声|声音/), false);

const extraCases: Array<[string, (idea: string) => boolean, boolean]> = [
  ['合成八个不同音高的音符，颜色对应音高。', isMicrophoneInputRequest, false],
  ['播放特定频率的合成音。', isWhistlePitchRequest, false],
  ['使用振荡器控制audio frequency。', isWhistlePitchRequest, false],
  ['识别口哨的音高控制游戏。', isWhistlePitchRequest, true],
  ['做一个音高检测器。', isWhistlePitchRequest, true],
  ['检测声音的特定频率控制游戏。', isMicrophoneInputRequest, true],
  ['不做音高检测，只播放合成音。', isMicrophoneInputRequest, false],
  ['不做音高检测，但要使用麦克风分析音量。', isMicrophoneInputRequest, true],
  ['不要microphone，不做pitch detection。', isMicrophoneInputRequest, false],
  ['Track pitch from the microphone.', isMicrophoneInputRequest, true],
  ['Simulate acceleration and friction with keyboard input.', isMotionSensorRequest, false],
  ['用方向键控制小球加速度，模拟倾斜地图。', isMotionSensorRequest, false],
  ['屏幕上的树木摇晃，鼠标控制粒子。', isMotionSensorRequest, false],
  ['通过手机倾斜方向控制小球。', isMotionSensorRequest, true],
  ['倾斜手机控制小球。', isMotionSensorRequest, true],
  ['获取手机加速度控制赛车。', isMotionSensorRequest, true],
  ['通过加速度传感器控制游戏。', isMotionSensorRequest, true],
  ['Use the accelerometer to control a ball.', isMotionSensorRequest, true],
  ['Tilt your phone to move the ball.', isMotionSensorRequest, true],
  ['Listen to window.AiyaBodyMotion.', isMotionSensorRequest, true],
  ['不要读取加速度，只用方向键。', isMotionSensorRequest, false],
  ['不使用deviceorientation，但要通过陀螺仪操控小球。', isMotionSensorRequest, true],
];
for (const [idea, detector, expected] of extraCases) assert.equal(detector(idea), expected, idea);
const web = JSON.parse(readFileSync(new URL('../src/app/_shared/golden-key.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../../android-v3/app/src/main/assets/golden-key.json', import.meta.url), 'utf8'));
for (const example of web.examples) {
  assert.equal(isMicrophoneInputRequest(example.prompt), false, `${example.id}: no desktop microphone requirement`);
  assert.equal(isMotionSensorRequest(example.prompt), false, `${example.id}: no desktop motion requirement`);
  assert.equal(isCameraInputRequest(example.prompt), false, `${example.id}: no desktop camera requirement`);
  assert(!assessBuildRequest(example.prompt).signals.includes('device-media'), `${example.id}: routing agrees with capability checks`);
}
assert.equal(isMicrophoneInputRequest(app.examples.find((e: any) => e.id === 'sound-garden').prompt), true);
assert.equal(isMotionSensorRequest(app.examples.find((e: any) => e.id === 'gravity-maze').prompt), true);

console.log(JSON.stringify({
  ok: true,
  suite: 'teacher-coder-negation-aware-intent',
  regressionCases: extraCases.length,
  desktopCatalogCases: web.examples.length,
  appMicrophoneAndMotionPreserved: true,
}, null, 2));
