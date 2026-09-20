import { clientBundle } from '../../client/tsdown.client.ts'

/** Skip official Host/Client workspace faces; Desktop builds this package itself. */
export default (options: { env?: { DSH_BUILD_FACE?: string } }) => {
  const face = options.env?.DSH_BUILD_FACE
  if (face === 'host' || face === 'client') return { entry: '' }
  return clientBundle('@ainfinity/dsh-wechat-ui', ['src/index.ts'])(options)
}
