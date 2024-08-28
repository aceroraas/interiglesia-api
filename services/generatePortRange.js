
export const generatePortRange = (start, end) => {
   return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};