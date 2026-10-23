/**
 * 程序入口：只做一次分发。
 *
 * 打包后 package.json 的 main 指向 dist/main/entry.js，而不是直接指向 main.js，
 * 因为「启动前的显卡探针」需要用同一个可执行文件再起一个进程（见 gpuProbeMain.ts），
 * 而打包成 app 之后，命令行里给的脚本路径会被忽略，只能靠环境变量从入口处分流。
 */
if (process.env.AI_SCHEDULE_GPU_PROBE === '1') {
  // 探针模式：只验证「这一级 GPU 兼容开关能不能开起来」，不加载正常业务
  require('./gpuProbeMain')
} else {
  require('./main')
}
