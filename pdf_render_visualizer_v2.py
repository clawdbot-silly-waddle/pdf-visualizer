#!/usr/bin/env python3
"""
PDF Rendering Instruction Visualizer v2
Uses pikepdf for proper content stream parsing and PyMuPDF for rendering.
Creates an animated GIF showing PDF operators being executed step-by-step.
"""

import io
import copy
from pathlib import Path
from typing import List, Tuple, Optional
from PIL import Image, ImageDraw, ImageFont
import imageio

# For parsing content streams properly
import pikepdf

# For rendering PDFs
import pymupdf

# For creating test PDFs
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as rl_canvas


def create_test_pdf(filepath: str):
    """Create a simple test PDF with various drawing operations."""
    c = rl_canvas.Canvas(filepath, pagesize=letter)
    width, height = letter
    
    # Title
    c.setFont("Helvetica-Bold", 24)
    c.drawString(180, height - 60, "PDF Render Test")
    
    # Draw a filled rectangle
    c.setStrokeColorRGB(0.2, 0.4, 0.8)
    c.setFillColorRGB(0.8, 0.9, 1.0)
    c.setLineWidth(3)
    c.rect(50, height - 200, 200, 100, fill=1, stroke=1)
    
    # Draw some text inside
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 14)
    c.drawString(80, height - 150, "Hello, PDF!")
    
    # Draw a circle
    c.setStrokeColorRGB(0.8, 0.2, 0.2)
    c.setFillColorRGB(1.0, 0.8, 0.8)
    c.circle(450, height - 150, 50, fill=1, stroke=1)
    
    # Draw some lines
    c.setStrokeColorRGB(0.2, 0.6, 0.2)
    c.setLineWidth(2)
    c.line(50, height - 250, 550, height - 250)
    c.line(50, height - 260, 550, height - 260)
    
    # Draw a triangle
    c.setFillColorRGB(0.9, 0.9, 0.5)
    c.setStrokeColorRGB(0.6, 0.6, 0.0)
    path = c.beginPath()
    path.moveTo(150, height - 400)
    path.lineTo(250, height - 300)
    path.lineTo(350, height - 400)
    path.close()
    c.drawPath(path, fill=1, stroke=1)
    
    # More text
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.setFont("Helvetica", 12)
    c.drawString(50, height - 450, "This is a demonstration of PDF rendering operators.")
    c.drawString(50, height - 470, "Each operator is executed step-by-step to create this page.")
    
    c.save()
    print(f"Created test PDF: {filepath}")


def parse_content_stream(pdf_path: str) -> Tuple[List[Tuple], bytes]:
    """
    Parse the content stream from the first page of a PDF.
    Returns list of (operands, operator) tuples and the raw bytes.
    """
    with pikepdf.open(pdf_path) as pdf:
        page = pdf.pages[0]
        
        # Parse content stream into operators
        instructions = list(pikepdf.parse_content_stream(page))
        
        # Also get the raw content for reference
        contents = page.get('/Contents')
        if isinstance(contents, pikepdf.Stream):
            raw_content = contents.read_bytes()
        elif isinstance(contents, pikepdf.Array):
            raw_content = b'\n'.join(s.read_bytes() for s in contents)
        else:
            raw_content = b''
        
        return instructions, raw_content


def operator_to_string(operands, operator) -> str:
    """Convert an operator and its operands to a readable string."""
    op_str = str(operator)
    
    # Format operands
    operand_strs = []
    for op in operands:
        if isinstance(op, (int, float)):
            operand_strs.append(f"{op:.2f}" if isinstance(op, float) else str(op))
        elif isinstance(op, pikepdf.Name):
            operand_strs.append(str(op))
        elif isinstance(op, pikepdf.String):
            text = str(op)
            if len(text) > 20:
                text = text[:17] + "..."
            operand_strs.append(f"({text})")
        elif isinstance(op, pikepdf.Array):
            operand_strs.append("[...]")
        else:
            operand_strs.append(str(op)[:15])
    
    if operand_strs:
        return f"{' '.join(operand_strs)} {op_str}"
    return op_str


def is_visual_operator(operator) -> bool:
    """Check if this operator produces visible output or important state changes."""
    op_str = str(operator)
    
    # Painting operators (produce visible output)
    painting_ops = {
        'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*',  # Path painting
        'Tj', 'TJ', "'", '"',  # Text showing
        'Do',  # XObject (images)
        'sh',  # Shading
    }
    
    # State-changing operators that affect rendering
    state_ops = {
        'q', 'Q',  # Save/restore graphics state
        'cm',  # Transform
        'w', 'J', 'j', 'M', 'd',  # Line style
        'g', 'G', 'rg', 'RG', 'k', 'K',  # Color
        'cs', 'CS', 'sc', 'SC', 'scn', 'SCN',  # Color space
        'BT', 'ET',  # Text blocks
        'Tf', 'Td', 'TD', 'Tm', 'T*',  # Text positioning
        'm', 'l', 'c', 'v', 'y', 'h', 're',  # Path construction
    }
    
    return op_str in painting_ops or op_str in state_ops


def get_operator_description(operator) -> str:
    """Get a human-readable description of what the operator does."""
    descriptions = {
        # Path construction
        'm': 'Move to point',
        'l': 'Line to point',
        'c': 'Bezier curve',
        'v': 'Bezier (initial pt = current)',
        'y': 'Bezier (final pt = control)',
        'h': 'Close path',
        're': 'Rectangle',
        
        # Path painting
        'S': 'Stroke path',
        's': 'Close & stroke',
        'f': 'Fill path',
        'F': 'Fill path',
        'f*': 'Fill (even-odd)',
        'B': 'Fill & stroke',
        'B*': 'Fill & stroke (even-odd)',
        'b': 'Close, fill & stroke',
        'b*': 'Close, fill & stroke (even-odd)',
        'n': 'End path (no paint)',
        
        # Graphics state
        'q': 'Save state',
        'Q': 'Restore state',
        'cm': 'Transform matrix',
        'w': 'Set line width',
        'J': 'Set line cap',
        'j': 'Set line join',
        'M': 'Set miter limit',
        'd': 'Set dash pattern',
        
        # Color
        'g': 'Set gray (fill)',
        'G': 'Set gray (stroke)',
        'rg': 'Set RGB (fill)',
        'RG': 'Set RGB (stroke)',
        'k': 'Set CMYK (fill)',
        'K': 'Set CMYK (stroke)',
        'cs': 'Set colorspace (fill)',
        'CS': 'Set colorspace (stroke)',
        'sc': 'Set color (fill)',
        'SC': 'Set color (stroke)',
        'scn': 'Set color (fill)',
        'SCN': 'Set color (stroke)',
        
        # Text
        'BT': 'Begin text',
        'ET': 'End text',
        'Tf': 'Set font',
        'Td': 'Move text position',
        'TD': 'Move text & set leading',
        'Tm': 'Set text matrix',
        'T*': 'Next line',
        'Tj': 'Show text',
        'TJ': 'Show text (array)',
        "'": 'Next line & show',
        '"': 'Set spacing & show',
        
        # XObjects
        'Do': 'Draw XObject',
    }
    
    return descriptions.get(str(operator), str(operator))


def create_partial_pdf(original_path: str, instructions: List[Tuple], 
                       num_instructions: int, temp_path: str) -> bool:
    """
    Create a temporary PDF with only the first N instructions.
    Returns True if successful.
    """
    try:
        with pikepdf.open(original_path) as pdf:
            page = pdf.pages[0]
            
            # Get the subset of instructions
            partial_instructions = instructions[:num_instructions]
            
            # Unparse back to content stream
            new_content = pikepdf.unparse_content_stream(partial_instructions)
            
            # Replace the page content
            page.Contents = pdf.make_stream(new_content)
            
            # Save to temp file
            pdf.save(temp_path)
            
        return True
    except Exception as e:
        print(f"Error creating partial PDF at instruction {num_instructions}: {e}")
        return False


def render_pdf_page(pdf_path: str, scale: float = 1.0) -> Optional[Image.Image]:
    """Render the first page of a PDF to a PIL Image using PyMuPDF."""
    try:
        doc = pymupdf.open(pdf_path)
        page = doc[0]
        
        # Create a transformation matrix for scaling
        mat = pymupdf.Matrix(scale, scale)
        
        # Render to pixmap
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to PIL Image
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        
        doc.close()
        return img
    except Exception as e:
        print(f"Error rendering PDF: {e}")
        return None


def add_operator_overlay(image: Image.Image, operator_text: str, 
                        description: str, step: int, total: int) -> Image.Image:
    """Add an overlay showing the current operator."""
    img = image.copy()
    draw = ImageDraw.Draw(img)
    
    # Get dimensions
    width, height = img.size
    
    # Draw semi-transparent background at bottom
    overlay_height = 50
    draw.rectangle(
        [(0, height - overlay_height), (width, height)],
        fill=(30, 30, 30, 230)
    )
    
    # Try to get a nice font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 13)
        small_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
    except:
        font = ImageFont.load_default()
        small_font = font
    
    # Draw step counter
    step_text = f"Step {step}/{total}"
    draw.text((10, height - overlay_height + 5), step_text, fill=(150, 150, 150), font=small_font)
    
    # Draw operator
    if len(operator_text) > 50:
        operator_text = operator_text[:47] + "..."
    draw.text((10, height - overlay_height + 20), f"▶ {operator_text}", fill=(0, 255, 100), font=font)
    
    # Draw description on the right
    desc_x = width - 200
    draw.text((desc_x, height - overlay_height + 20), description, fill=(200, 200, 200), font=small_font)
    
    return img


def create_visualization(pdf_path: str, output_path: str,
                        frame_duration: float = 0.2,
                        scale: float = 0.8,
                        skip_non_visual: bool = True,
                        max_frames: int = 200):
    """
    Create an animated GIF visualization of PDF rendering.
    
    Args:
        pdf_path: Path to input PDF
        output_path: Path for output GIF  
        frame_duration: Duration of each frame in seconds
        scale: Scale factor for output
        skip_non_visual: If True, skip operators that don't change appearance
        max_frames: Maximum number of frames to generate
    """
    print(f"Parsing content stream from: {pdf_path}")
    instructions, raw_content = parse_content_stream(pdf_path)
    total_instructions = len(instructions)
    print(f"Found {total_instructions} instructions")
    
    # Show first few instructions
    print("\nFirst 15 instructions:")
    for i, (operands, operator) in enumerate(instructions[:15]):
        print(f"  {i+1}: {operator_to_string(operands, operator)}")
    
    # Determine which instructions to visualize
    if skip_non_visual:
        # Find indices of visual operators
        visual_indices = []
        for i, (operands, operator) in enumerate(instructions):
            if is_visual_operator(operator):
                visual_indices.append(i + 1)  # +1 because we include instructions up to and including this one
        
        # Also always include the final state
        if total_instructions not in visual_indices:
            visual_indices.append(total_instructions)
        
        instruction_counts = visual_indices[:max_frames]
    else:
        instruction_counts = list(range(1, min(total_instructions + 1, max_frames + 1)))
    
    print(f"\nWill generate {len(instruction_counts)} frames")
    
    # Create temp directory
    temp_dir = Path("/home/claude/pdf_viz_temp")
    temp_dir.mkdir(exist_ok=True)
    temp_pdf = temp_dir / "partial.pdf"
    
    frames = []
    
    # Calculate consistent frame size
    frame_width = int(612 * scale)
    frame_height = int(792 * scale)
    
    # First frame: blank page (0 instructions)
    blank_img = Image.new('RGB', (frame_width, frame_height), (255, 255, 255))
    frames.append(add_operator_overlay(blank_img, "(start)", "Begin rendering", 0, len(instruction_counts)))
    
    # Generate frames for each instruction count
    for frame_idx, num_inst in enumerate(instruction_counts):
        print(f"  Rendering frame {frame_idx + 1}/{len(instruction_counts)} (instructions 1-{num_inst})", end='\r')
        
        # Create partial PDF
        if not create_partial_pdf(pdf_path, instructions, num_inst, str(temp_pdf)):
            continue
        
        # Render it
        img = render_pdf_page(str(temp_pdf), scale)
        if img is None:
            continue
        
        # Ensure consistent size (resize if needed)
        if img.size != (frame_width, frame_height):
            img = img.resize((frame_width, frame_height), Image.Resampling.LANCZOS)
        
        # Get info about the last instruction added
        operands, operator = instructions[num_inst - 1]
        op_text = operator_to_string(operands, operator)
        description = get_operator_description(operator)
        
        # Add overlay
        frame = add_operator_overlay(img, op_text, description, frame_idx + 1, len(instruction_counts))
        frames.append(frame)
    
    print(f"\nGenerated {len(frames)} frames")
    
    # Clean up temp files
    if temp_pdf.exists():
        temp_pdf.unlink()
    
    # Save as GIF
    print(f"Saving GIF to: {output_path}")
    imageio.mimsave(output_path, frames, duration=frame_duration, loop=0)
    
    # Also save a high-quality final frame
    final_frame_path = output_path.replace('.gif', '_final.png')
    if frames:
        frames[-1].save(final_frame_path)
        print(f"Saved final frame to: {final_frame_path}")
    
    print("Done!")
    return len(instructions), len(frames)


def main():
    """Main entry point."""
    output_dir = Path("/home/claude/pdf_viz_output")
    output_dir.mkdir(exist_ok=True)
    
    # Create test PDF
    test_pdf = output_dir / "test_document.pdf"
    create_test_pdf(str(test_pdf))
    
    # Create visualization
    output_gif = output_dir / "pdf_rendering_v2.gif"
    num_ops, num_frames = create_visualization(
        str(test_pdf),
        str(output_gif),
        frame_duration=0.25,  # 250ms per frame
        scale=0.8,
        skip_non_visual=True,  # Only show frames when something changes
        max_frames=150
    )
    
    print(f"\nSummary:")
    print(f"  Total operators: {num_ops}")
    print(f"  Frames generated: {num_frames}")
    print(f"  Output: {output_gif}")
    
    return str(output_gif)


if __name__ == "__main__":
    result = main()
