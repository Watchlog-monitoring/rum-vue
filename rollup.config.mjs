import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'   // ✅ default import
// اگر فعلاً d.ts نداری، این خط رو حذف کن:
// import dts from 'rollup-plugin-dts'

const external = ['vue', 'vue-router']

export default [
  // JS builds: ESM + CJS
  {
    input: 'src/index.js',
    external,
    output: [
      { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
      { file: 'dist/index.cjs', format: 'cjs', sourcemap: true, exports: 'named' }
    ],
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      terser()
    ]
  },

  // ❗ اگر هنوز فایل تایپ نداری، تا اطلاع ثانوی این بلاک را کامنت/حذف کن
  // {
  //   input: 'dist/index.d.ts',
  //   output: [{ file: 'dist/index.d.ts', format: 'es' }],
  //   plugins: [dts()]
  // }
]
