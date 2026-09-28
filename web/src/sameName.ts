// Two names of a category or payee are the same one when they differ only in
// case or outer spaces: the server refuses the second (#531), and the forms say
// so before asking it.
export const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
