// Both interfaces operate on the same rows. No JSON copy or second stock exists.
export {
  obtenerInventarioSistema as obtenerInventario,
  obtenerLlantaSistema as obtenerLlanta,
  buscarLlantasSistema as buscarLlantas,
  crearLlantaSistema as crearLlanta,
  actualizarLlantaSistema as actualizarLlanta,
  eliminarLlantaSistema as eliminarLlanta,
  ajustarStockSistema as ajustarStock,
  moverStockSistema as moverStock,
  obtenerMovimientosSistema as obtenerMovimientos,
  obtenerStockBajoSistema as obtenerStockBajo,
} from './sistema-inventario';
