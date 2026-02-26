declare module 'xlsx-populate' {
  interface StyleOptions {
    bold?: boolean;
    fontColor?: string;
    fill?: { type: 'solid'; color: string };
  }

  interface Cell {
    value(val?: unknown): this;
    style(opts: StyleOptions): this;
    style(name: string, val: unknown): this;
  }

  interface Range {
    style(opts: StyleOptions): this;
    style(name: string, val: unknown): this;
  }

  interface Column {
    width(val?: number): this;
  }

  interface Sheet {
    name(val?: string): string | this;
    cell(row: number, col: number): Cell;
    column(col: number | string): Column;
    range(addr: string): Range;
  }

  interface Workbook {
    sheet(indexOrName: number | string): Sheet;
    addSheet(name: string, indexOrBefore?: number | string | Sheet): Sheet;
    deleteSheet(indexOrNameOrSheet: number | string | Sheet): this;
    outputAsync(type?: string): Promise<Buffer | ArrayBuffer>;
  }

  const XlsxPopulate: {
    fromBlankAsync(): Promise<Workbook>;
  };
  export default XlsxPopulate;
}
