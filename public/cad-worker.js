/* OCCT is loaded only for CAD import, in an isolated, terminable worker. */
importScripts("./cad/occt-import-js.js");
self.onmessage = async ({ data }) => {
  try {
    const occt = await occtimportjs({
      locateFile: (path) => new URL("./cad/" + path, self.location.href).href,
    });
    const options = {
      linearUnit: "meter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.005,
      angularDeflection: 0.5,
    };
    const read =
      data.format === "iges"
        ? occt.ReadIgesFile
        : data.format === "brep"
          ? occt.ReadBrepFile
          : occt.ReadStepFile;
    const result = read(new Uint8Array(data.buffer), options);
    if (!result.success || !result.meshes?.length)
      throw Error("Не удалось прочитать CAD-файл.");
    if (result.meshes.length > 128)
      throw Error("Слишком много частей: максимум 128.");
    let total = 0;
    const parts = result.meshes.map((mesh, index) => {
      const values = mesh.attributes.position.array,
        indices = mesh.index.array;
      total += indices.length / 3;
      if (total > 3000 || values.length > 45000)
        throw Error(
          "CAD-модель превышает лимит 3000 граней. Экспортируйте упрощённую модель.",
        );
      const positions = [];
      for (let i = 0; i < values.length; i += 3)
        positions.push(values.slice(i, i + 3));
      const polygons = [];
      for (let i = 0; i < indices.length; i += 3)
        polygons.push(indices.slice(i, i + 3));
      return {
        name: mesh.name || "Деталь " + (index + 1),
        positions,
        polygons,
      };
    });
    postMessage({ parts });
  } catch (error) {
    postMessage({
      error: error instanceof Error ? error.message : "Ошибка CAD-импорта",
    });
  }
};
