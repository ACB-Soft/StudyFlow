import * as pdfjsLib from 'pdfjs-dist';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PDFChapter {
  title: string;
  pageNumber: number;
}

export async function parsePDFChapters(
  arrayBuffer: ArrayBuffer, 
  onProgress?: (progress: number) => void
): Promise<PDFChapter[]> {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  
  const chapters: PDFChapter[] = [];
  const skipKeywords = [
    "önsöz", "teşekkür", "teşekkürler", "içindekiler", "giriş", 
    "kaynaklar", "dizin", "indeks", "preface", "acknowledgments", 
    "contents", "introduction", "references", "index", "sunuş", "takdim"
  ];

  // 1. Try to get internal PDF outline (metadata)
  const outline = await pdf.getOutline();
  if (outline && outline.length > 0) {
    for (const item of outline) {
      const titleLower = item.title.toLowerCase().trim();
      // Skip non-chapter sections
      if (skipKeywords.some(k => titleLower === k || titleLower.startsWith(k + " "))) continue;
      
      if (item.dest) {
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (dest) {
            const pageIndex = await pdf.getPageIndex(dest[0]);
            const pageNumber = pageIndex + 1;
            
            // Avoid duplicates on the same page
            if (!chapters.find(c => c.pageNumber === pageNumber)) {
              chapters.push({
                title: item.title,
                pageNumber: pageNumber
              });
            }
          }
        } catch (e) {
          console.warn("Could not resolve destination for outline item:", item.title);
        }
      }
    }
    if (chapters.length > 0) {
      return chapters.sort((a, b) => a.pageNumber - b.pageNumber);
    }
  }

  // 2. Deep Scan: Multi-Pass Verification System
  // Pass A: Identify potential candidates using regex, font heuristics, and academic markers
  const candidates: { title: string, pageNumber: number, fontSize: number, y: number, confidence: number }[] = [];
  
  for (let i = 1; i <= totalPages; i++) {
    // Report progress
    if (onProgress) {
      onProgress(Math.round((i / totalPages) * 100));
    }

    // Artificial delay for thorough analysis (at least 0.1s per page)
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    
    if (items.length === 0) continue;

    // Sort items by vertical position (top to bottom)
    items.sort((a, b) => b.transform[5] - a.transform[5]);

    const chapterRegex = /^(?:Bölüm\s+([0-9A-Z]+)|([0-9]+)\.\s*Bölüm|Chapter\s+([0-9A-Z]+)|Kısım\s+([0-9A-Z]+)|Section\s+([0-9A-Z]+)|Ünite\s+([0-9A-Z]+))/i;
    const academicTitlesRegex = /^(?:Prof\.|Dr\.|Doç\.|Öğr\.\s*Gör\.|Yrd\.\s*Doç\.|Asist\.|Lecturer|Yazar|Editör)/i;
    const bibliographyRegex = /^(?:Kaynakça|References|Bibliyografya|Kaynaklar|Works\s+Cited)/i;

    // Scan more items per page for better accuracy
    let pageHasAcademicTitle = false;
    let pageHasBibliography = false;
    let potentialTitle = "";
    let maxFontSizeOnPage = 0;

    for (let j = 0; j < Math.min(items.length, 60); j++) {
      const item = items[j];
      const text = item.str.trim();
      if (text.length < 2) continue;

      const fontSize = Math.abs(item.transform[3]);
      if (fontSize > maxFontSizeOnPage) maxFontSizeOnPage = fontSize;

      const textLower = text.toLowerCase();
      if (skipKeywords.some(k => textLower === k || textLower.startsWith(k + " "))) break;

      const yPos = item.transform[5];
      const isNearTop = yPos > 300;

      // Check for Bibliography (End of chapter marker)
      if (bibliographyRegex.test(text) && isNearTop) {
        pageHasBibliography = true;
      }

      // Check for Academic Titles (Start of chapter marker)
      if (academicTitlesRegex.test(text) && yPos > 200) {
        pageHasAcademicTitle = true;
      }

      // Check Regex Match (High Confidence)
      const regexMatch = text.match(chapterRegex);
      if (regexMatch && isNearTop) {
        candidates.push({
          title: text,
          pageNumber: i,
          fontSize,
          y: yPos,
          confidence: 0.95
        });
        break; 
      }
      
      // Potential title candidate (Large font)
      if (fontSize > 18 && text.length > 3 && yPos > 400 && !potentialTitle) {
        potentialTitle = text;
      }
    }

    // Heuristic: If page has academic title and a large font text, it's likely a chapter start
    if (pageHasAcademicTitle && potentialTitle) {
      candidates.push({
        title: potentialTitle,
        pageNumber: i,
        fontSize: maxFontSizeOnPage,
        y: 500,
        confidence: 0.85
      });
    }
  }

  // Pass B: Cross-validate candidates to filter out noise
  if (candidates.length > 0) {
    const filteredChapters: PDFChapter[] = [];
    
    for (let i = 0; i < candidates.length; i++) {
      const current = candidates[i];
      const last = filteredChapters[filteredChapters.length - 1];
      
      // Rule 1: Minimum distance between chapters (academic chapters are usually > 5 pages)
      if (last && (current.pageNumber - last.pageNumber < 3)) continue;
      
      // Rule 2: Filter out repeating headers
      if (last && last.title === current.title) continue;
      
      // Rule 3: High confidence or strong academic markers
      if (current.confidence >= 0.8) {
        filteredChapters.push({ title: current.title, pageNumber: current.pageNumber });
      }
    }
    
    if (filteredChapters.length > 0) {
      return filteredChapters.sort((a, b) => a.pageNumber - b.pageNumber);
    }
  }

  if (chapters.length > 0) {
    return chapters.sort((a, b) => a.pageNumber - b.pageNumber);
  }

  // 3. Final Fallback: If no chapters detected, treat the whole book as one chapter
  return [{ title: "Kitap İçeriği", pageNumber: 1 }];
}
